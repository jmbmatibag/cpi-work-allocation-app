/**
 * Allocations integration tests.
 *
 * Tests the CRUD lifecycle: upsert draft → submit → approve.
 * Uses a seeded Employee + Manager pair; cleans up after itself.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

// Keep the real template builders + recipient resolver; stub only the
// actual senders so tests neither hit SMTP nor depend on env config.
vi.mock('../lib/mailer.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/mailer.js')>();
  return {
    ...actual,
    sendOtpEmail: vi.fn().mockResolvedValue(undefined),
    sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
    verifySmtp: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const app = createApp();

type RoleArr = ('Employee' | 'Manager' | 'Finance' | 'Admin')[];

const EMP = {
  id: 'TEST_ALLOC_EMP', firstName: 'Alloc', lastName: 'Employee',
  email: 'alloc.emp@cpi.com.ph', roles: ['Employee'] as RoleArr,
  team: 'IT/Platforms', jobTitle: 'Tester',
};
const MGR = {
  id: 'TEST_ALLOC_MGR', firstName: 'Alloc', lastName: 'Manager',
  email: 'alloc.mgr@cpi.com.ph', roles: ['Manager'] as RoleArr,
  team: 'IT/Platforms', jobTitle: 'Manager',
};

// Session lock: the JWT's sessionId must match User.activeSessionId, so each
// token carries a fixed sessionId and we stamp the same value on the user.
const EMP_SESSION = 'test-sess-alloc-emp';
const MGR_SESSION = 'test-sess-alloc-mgr';

function cookie(userId: string, roles: string[], sessionId: string) {
  const token = jwt.sign({ sub: userId, roles, sessionId }, process.env.JWT_SECRET!, {
    expiresIn: 3600, algorithm: 'HS256',
  });
  return `auth_token=${token}`;
}

const empCookie = cookie(EMP.id, EMP.roles, EMP_SESSION);
const mgrCookie = cookie(MGR.id, MGR.roles, MGR_SESSION);

// Anchor passwordUpdatedAt safely in the past so the token's iat is always
// newer (the auth middleware revokes tokens issued before a password change).
const PW_UPDATED = new Date('2020-01-01T00:00:00Z');

beforeAll(async () => {
  const hash = await bcrypt.hash('test', 10);
  await prisma.user.upsert({
    where: { id: MGR.id },
    create: { ...MGR, passwordHash: hash, managerId: null, activeSessionId: MGR_SESSION, passwordUpdatedAt: PW_UPDATED },
    update: { activeSessionId: MGR_SESSION, passwordUpdatedAt: PW_UPDATED },
  });
  await prisma.user.upsert({
    where: { id: EMP.id },
    create: { ...EMP, passwordHash: hash, managerId: MGR.id, activeSessionId: EMP_SESSION, passwordUpdatedAt: PW_UPDATED },
    update: { activeSessionId: EMP_SESSION, passwordUpdatedAt: PW_UPDATED, managerId: MGR.id },
  });
});

afterAll(async () => {
  // Approving the team here fires the Finance team-completion notice, which
  // fans out to every real Finance/Admin user in the dev DB. Deleting the
  // test users won't remove those fan-out rows, so scrub them by the test
  // manager's name before tearing the users down.
  await prisma.notification.deleteMany({
    where: {
      title: 'Team Allocations Fully Approved',
      message: { contains: `${MGR.firstName} ${MGR.lastName}` },
    },
  });
  await prisma.allocationRecord.deleteMany({ where: { employeeId: EMP.id } });
  await prisma.user.deleteMany({ where: { id: { in: [EMP.id, MGR.id] } } });
  await prisma.$disconnect();
});

const DRAFT_BODY = {
  employeeId: EMP.id,
  team: 'IT/Platforms',
  managerId: MGR.id,
  month: 'May',
  year: '2026',
  monthIndex: 4,
  streams: [
    {
      category: 'IT',
      expanded: true,
      activities: [
        {
          id: 'test-act-001',
          team: 'IT/Platforms',
          workCategory: 'IT',
          subCategory: null,
          workType: 'Infrastructure',
          client: 'Internal',
          description: 'Test activity',
          percentage: 100,
          expanded: true,
        },
      ],
    },
  ],
};

describe('Allocation lifecycle', () => {
  let recordId: string;

  it('401 without auth', async () => {
    const res = await request(app).get('/api/allocations');
    expect(res.status).toBe(401);
  });

  it('creates a Draft via POST /api/allocations', async () => {
    const res = await request(app)
      .post('/api/allocations')
      .set('Cookie', empCookie)
      .send(DRAFT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Draft');
    expect(res.body.employeeId).toBe(EMP.id);
    recordId = res.body.id;
  });

  it('GET /api/allocations returns the draft for the employee', async () => {
    const res = await request(app)
      .get('/api/allocations')
      .set('Cookie', empCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((r: { id: string }) => r.id === recordId)).toBe(true);
  });

  it('submits the draft via POST /api/allocations/:id/submit', async () => {
    const res = await request(app)
      .post(`/api/allocations/${recordId}/submit`)
      .set('Cookie', empCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PendingReview');
  });

  it('403 when employee tries to approve', async () => {
    const res = await request(app)
      .post(`/api/allocations/${recordId}/approve`)
      .set('Cookie', empCookie);

    expect(res.status).toBe(403);
  });

  it('manager approves the allocation', async () => {
    const res = await request(app)
      .post(`/api/allocations/${recordId}/approve`)
      .set('Cookie', mgrCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Approved');
  });

  it('409 when trying to overwrite an Approved allocation', async () => {
    const res = await request(app)
      .post('/api/allocations')
      .set('Cookie', empCookie)
      .send(DRAFT_BODY);

    expect(res.status).toBe(409);
  });
});

// Epic 3 — optimistic-concurrency guard on approve/return, plus the
// accountability stamp (who ACTUALLY actioned the record). Uses its own
// period ('June') so it doesn't collide with the lifecycle block's record
// on the unique (employeeId, month, year) index.
describe('Approve/return concurrency guard + accountability', () => {
  let recordId: string;

  beforeAll(async () => {
    const create = await request(app)
      .post('/api/allocations')
      .set('Cookie', empCookie)
      // Distinct activity id — AllocationActivity.id is a PK, so reusing the
      // lifecycle record's 'test-act-001' would collide.
      .send({
        ...DRAFT_BODY,
        month: 'June',
        monthIndex: 5,
        streams: [
          {
            ...DRAFT_BODY.streams[0],
            activities: [
              { ...DRAFT_BODY.streams[0].activities[0], id: 'test-act-june-001' },
            ],
          },
        ],
      });
    if (!create.body?.id) {
      throw new Error(
        `setup: draft create failed (${create.status}): ${JSON.stringify(create.body)}`,
      );
    }
    recordId = create.body.id;
    const sub = await request(app)
      .post(`/api/allocations/${recordId}/submit`)
      .set('Cookie', empCookie);
    if (sub.status !== 200) {
      throw new Error(`setup: submit failed (${sub.status}): ${JSON.stringify(sub.body)}`);
    }
  });

  it('409s when expectedStatus no longer matches (a peer got there first)', async () => {
    const res = await request(app)
      .post(`/api/allocations/${recordId}/approve`)
      .set('Cookie', mgrCookie)
      // The reviewer's page thinks it was returned, but it's actually still
      // PendingReview — simulates acting on a stale view.
      .send({ expectedStatus: 'NeedsRevision' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already actioned by another manager/i);
  });

  it('approves when expectedStatus matches and stamps the actor', async () => {
    const res = await request(app)
      .post(`/api/allocations/${recordId}/approve`)
      .set('Cookie', mgrCookie)
      .send({ expectedStatus: 'PendingReview' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Approved');
    // Accountability: the response carries who actually approved it.
    expect(res.body.actionedBy?.userName).toBe(`${MGR.firstName} ${MGR.lastName}`);
  });

  it('409s a second approve now that the status has moved on', async () => {
    const res = await request(app)
      .post(`/api/allocations/${recordId}/approve`)
      .set('Cookie', mgrCookie)
      .send({ expectedStatus: 'PendingReview' });

    expect(res.status).toBe(409);
  });
});
