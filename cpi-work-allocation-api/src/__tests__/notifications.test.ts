/**
 * Notifications integration tests.
 *
 * Covers the DB-backed notification system that replaced the localStorage
 * store:
 *   - bell endpoints (list / self-create / mark-read / mark-all-read) and
 *     their per-user ownership scoping
 *   - Epic 2: Finance manual reminder (email + in-app, RBAC)
 *   - Epic 3: automated Finance/Admin notice when a manager's whole team
 *     is approved for a period
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import * as mailer from '../lib/mailer.js';

// Keep real builders; stub the senders so we can assert on them.
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
const sendSpy = vi.mocked(mailer.sendNotificationEmail);

type RoleArr = ('Employee' | 'Manager' | 'Finance' | 'Admin')[];

const MGR   = { id: 'TEST_NOTIF_MGR',   firstName: 'Notif', lastName: 'Manager',  email: 'notif.mgr@cpi.com.ph',   roles: ['Manager']  as RoleArr, team: 'IT/Platforms', jobTitle: 'Manager' };
const EMP   = { id: 'TEST_NOTIF_EMP',   firstName: 'Notif', lastName: 'Employee', email: 'notif.emp@cpi.com.ph',   roles: ['Employee'] as RoleArr, team: 'IT/Platforms', jobTitle: 'Tester' };
const FIN   = { id: 'TEST_NOTIF_FIN',   firstName: 'Notif', lastName: 'Finance',  email: 'notif.fin@cpi.com.ph',   roles: ['Finance']  as RoleArr, team: 'Finance',      jobTitle: 'Controller' };
const OTHER = { id: 'TEST_NOTIF_OTHER', firstName: 'Notif', lastName: 'Other',    email: 'notif.other@cpi.com.ph', roles: ['Employee'] as RoleArr, team: 'IT/Platforms', jobTitle: 'Tester' };

const PW_UPDATED = new Date('2020-01-01T00:00:00Z');
const ALL = [MGR, EMP, FIN, OTHER];

function cookie(userId: string, roles: string[]) {
  const sessionId = `sess-${userId}`;
  const token = jwt.sign({ sub: userId, roles, sessionId }, process.env.JWT_SECRET!, {
    expiresIn: 3600, algorithm: 'HS256',
  });
  return `auth_token=${token}`;
}

const mgrCookie   = cookie(MGR.id, MGR.roles);
const empCookie   = cookie(EMP.id, EMP.roles);
const finCookie   = cookie(FIN.id, FIN.roles);
const otherCookie = cookie(OTHER.id, OTHER.roles);

async function waitFor(
  fn: () => Promise<boolean> | boolean,
  timeoutMs = 3000,
  intervalMs = 40,
): Promise<boolean> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

const draftBody = (employeeId: string, managerId: string, month: string, monthIndex: number) => ({
  employeeId,
  team: 'IT/Platforms',
  managerId,
  month,
  year: '2099',
  monthIndex,
  streams: [
    {
      category: 'IT',
      expanded: true,
      activities: [
        {
          id: `act-${employeeId}-${monthIndex}`,
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
});

beforeAll(async () => {
  const hash = await bcrypt.hash('test', 10);
  for (const u of ALL) {
    const managerId = u.id === EMP.id ? MGR.id : null;
    await prisma.user.upsert({
      where: { id: u.id },
      create: { ...u, passwordHash: hash, managerId, activeSessionId: `sess-${u.id}`, passwordUpdatedAt: PW_UPDATED },
      update: { activeSessionId: `sess-${u.id}`, passwordUpdatedAt: PW_UPDATED, managerId },
    });
  }
});

afterAll(async () => {
  // The team-completion notice fans out to EVERY Finance/Admin user in the
  // DB — including real ones, since tests run against the dev DB. Deleting the
  // test users cascades only THEIR own notifications, so the fan-out rows
  // would otherwise linger in real Finance bells. Scrub them by the test
  // manager's name (`${MGR.firstName} ${MGR.lastName}`) so only this suite's
  // rows are removed.
  await prisma.notification.deleteMany({
    where: {
      title: 'Team Allocations Fully Approved',
      message: { contains: `${MGR.firstName} ${MGR.lastName}` },
    },
  });
  await prisma.allocationRecord.deleteMany({ where: { employeeId: { in: [EMP.id, OTHER.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: ALL.map((u) => u.id) } } });
  await prisma.$disconnect();
});

describe('Notification bell endpoints', () => {
  it('401 without auth', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('creates a self-notification and lists it back', async () => {
    const create = await request(app)
      .post('/api/notifications')
      .set('Cookie', empCookie)
      .send({ title: 'Self Note', message: 'hello me', type: 'info', actionUrl: '/allocations' });
    expect(create.status).toBe(201);

    const list = await request(app).get('/api/notifications').set('Cookie', empCookie);
    expect(list.status).toBe(200);
    const mine = list.body.find((n: { title: string }) => n.title === 'Self Note');
    expect(mine).toBeTruthy();
    expect(mine.targetUserId).toBe(EMP.id); // forced to the caller
    expect(mine.isRead).toBe(false);
  });

  it('marks one notification read (owner only)', async () => {
    const list = await request(app).get('/api/notifications').set('Cookie', empCookie);
    const id = list.body[0].id;

    // A different user cannot mark it read → 404 (scoped to owner).
    const forbidden = await request(app)
      .patch(`/api/notifications/${id}/read`)
      .set('Cookie', otherCookie);
    expect(forbidden.status).toBe(404);

    // The owner can.
    const ok = await request(app)
      .patch(`/api/notifications/${id}/read`)
      .set('Cookie', empCookie);
    expect(ok.status).toBe(200);

    const after = await request(app).get('/api/notifications').set('Cookie', empCookie);
    expect(after.body.find((n: { id: string }) => n.id === id).isRead).toBe(true);
  });

  it('marks all read', async () => {
    await request(app).post('/api/notifications').set('Cookie', empCookie)
      .send({ title: 'Another', message: 'x' });
    const res = await request(app).post('/api/notifications/read-all').set('Cookie', empCookie);
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/notifications').set('Cookie', empCookie);
    expect(list.body.every((n: { isRead: boolean }) => n.isRead)).toBe(true);
  });
});

describe('Epic 2 — manual reminder', () => {
  beforeAll(async () => {
    // A pending record so the reminder quotes a real outstanding count.
    await request(app).post('/api/allocations').set('Cookie', empCookie)
      .send(draftBody(EMP.id, MGR.id, 'July', 6));
    const list = await request(app).get('/api/allocations').set('Cookie', empCookie);
    const rec = list.body.find((r: { month: string }) => r.month === 'July');
    await request(app).post(`/api/allocations/${rec.id}/submit`).set('Cookie', empCookie);
  });

  it('403 for a non-Finance caller', async () => {
    const res = await request(app)
      .post('/api/notifications/manual-reminder')
      .set('Cookie', empCookie)
      .send({ managerIds: [MGR.id], month: 'July', year: '2099' });
    expect(res.status).toBe(403);
  });

  it('Finance can send a reminder (email + in-app)', async () => {
    sendSpy.mockClear();
    const res = await request(app)
      .post('/api/notifications/manual-reminder')
      .set('Cookie', finCookie)
      .send({ managerIds: [MGR.id], month: 'July', year: '2099' });

    expect(res.status).toBe(200);
    expect(res.body.sent).toContain(MGR.id);
    expect(res.body.skipped).toHaveLength(0);

    // Email sent with the spec subject line.
    expect(
      sendSpy.mock.calls.some((c) =>
        String(c[1]).includes('Overdue CPI Work Allocations'),
      ),
    ).toBe(true);

    // In-app notification landed in the manager's bell (fire-and-forget).
    const arrived = await waitFor(async () => {
      const n = await prisma.notification.findFirst({
        where: { targetUserId: MGR.id, title: 'Action Required: Overdue Work Allocations' },
      });
      return !!n;
    });
    expect(arrived).toBe(true);
  });
});

describe('Epic 3 — team-completion Finance notice', () => {
  it('notifies Finance/Admin when the manager approves the last allocation', async () => {
    sendSpy.mockClear();

    // EMP is MGR's only report; one record for the period → approving it
    // clears the whole team's queue.
    await request(app).post('/api/allocations').set('Cookie', empCookie)
      .send(draftBody(EMP.id, MGR.id, 'August', 7));
    const list = await request(app).get('/api/allocations').set('Cookie', empCookie);
    const rec = list.body.find((r: { month: string }) => r.month === 'August');
    await request(app).post(`/api/allocations/${rec.id}/submit`).set('Cookie', empCookie);

    const approve = await request(app)
      .post(`/api/allocations/${rec.id}/approve`)
      .set('Cookie', mgrCookie);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('Approved');

    // Finance/Admin in-app notice fired (fire-and-forget after the response).
    const finNotified = await waitFor(async () => {
      const n = await prisma.notification.findFirst({
        where: { targetUserId: FIN.id, title: 'Team Allocations Fully Approved' },
      });
      return !!n;
    });
    expect(finNotified).toBe(true);

    // …and the completion email went out.
    const emailed = await waitFor(() =>
      sendSpy.mock.calls.some((c) => String(c[1]).includes('fully approved')),
    );
    expect(emailed).toBe(true);
  });

  it('does NOT notify while a report is still Blank — only when the whole team is approved', async () => {
    sendSpy.mockClear();
    // Give MGR a second report for this period. OTHER will stay Blank at
    // first, so the team is not yet 100% approved.
    await prisma.user.update({ where: { id: OTHER.id }, data: { managerId: MGR.id } });
    try {
      // EMP submits + is approved for July; OTHER never submits.
      await request(app).post('/api/allocations').set('Cookie', empCookie)
        .send(draftBody(EMP.id, MGR.id, 'July', 6));
      const list = await request(app).get('/api/allocations').set('Cookie', empCookie);
      const rec = list.body.find((r: { month: string }) => r.month === 'July');
      await request(app).post(`/api/allocations/${rec.id}/submit`).set('Cookie', empCookie);
      const approve = await request(app)
        .post(`/api/allocations/${rec.id}/approve`)
        .set('Cookie', mgrCookie);
      expect(approve.status).toBe(200);

      // Team is NOT complete (OTHER is Blank) → no completion email for July.
      await new Promise((r) => setTimeout(r, 300));
      const firedEarly = sendSpy.mock.calls.some((c) =>
        String(c[1]).includes('fully approved July 2099'),
      );
      expect(firedEarly).toBe(false);

      // Now OTHER submits + is approved → team hits 100% → notice fires.
      await request(app).post('/api/allocations').set('Cookie', otherCookie)
        .send(draftBody(OTHER.id, MGR.id, 'July', 6));
      const list2 = await request(app).get('/api/allocations').set('Cookie', otherCookie);
      const rec2 = list2.body.find((r: { month: string }) => r.month === 'July');
      await request(app).post(`/api/allocations/${rec2.id}/submit`).set('Cookie', otherCookie);
      await request(app)
        .post(`/api/allocations/${rec2.id}/approve`)
        .set('Cookie', mgrCookie);

      const firedNow = await waitFor(() =>
        sendSpy.mock.calls.some((c) => String(c[1]).includes('fully approved July 2099')),
      );
      expect(firedNow).toBe(true);
    } finally {
      // Restore the original org graph so later assertions aren't affected.
      await prisma.user.update({ where: { id: OTHER.id }, data: { managerId: null } });
    }
  });
});
