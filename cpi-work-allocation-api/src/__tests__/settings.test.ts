/**
 * Settings integration tests.
 *
 * GET /api/settings is public (read-only taxonomy snapshot).
 * Mutation endpoints require auth — those are tested with a seeded admin cookie.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

vi.mock('../lib/mailer.js', () => ({ sendOtpEmail: vi.fn() }));

const TEST_ADMIN = {
  id:        'TEST_SETTINGS_ADM',
  firstName: 'Settings',
  lastName:  'Admin',
  email:     'settings.admin@cpi.com.ph',
  roles:     ['Admin'] as ('Employee' | 'Manager' | 'Finance' | 'Admin')[],
  team:      'IT/Platforms',
  jobTitle:  'Tester',
};

const app = createApp();

const ADMIN_SESSION = 'sess-settings-adm';
const PW_UPDATED = new Date('2020-01-01T00:00:00Z');

// Build a valid auth_token cookie for the test admin. The sessionId must
// match User.activeSessionId (single-session lock enforced by requireAuth).
function makeAuthCookie(userId: string, roles: string[]): string {
  const token = jwt.sign({ sub: userId, roles, sessionId: ADMIN_SESSION }, process.env.JWT_SECRET!, {
    expiresIn: 3600,
    algorithm: 'HS256',
  });
  return `auth_token=${token}`;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('test', 10);
  await prisma.user.upsert({
    where: { id: TEST_ADMIN.id },
    create: { ...TEST_ADMIN, passwordHash, managerId: null, activeSessionId: ADMIN_SESSION, passwordUpdatedAt: PW_UPDATED },
    update: { activeSessionId: ADMIN_SESSION, passwordUpdatedAt: PW_UPDATED },
  });
  // Ensure at least one team exists for the snapshot test
  await prisma.team.upsert({
    where: { name: 'IT/Platforms' },
    create: { name: 'IT/Platforms', sortOrder: 0 },
    update: {},
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: TEST_ADMIN.id } });
  await prisma.$disconnect();
});

describe('GET /api/settings', () => {
  it('returns the taxonomy snapshot for any authenticated user', async () => {
    const cookie = makeAuthCookie(TEST_ADMIN.id, TEST_ADMIN.roles);
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('teams');
    expect(res.body).toHaveProperty('clients');
    expect(res.body).toHaveProperty('mainCategories');
    expect(res.body).toHaveProperty('subCategories');
    expect(res.body).toHaveProperty('workTypes');
    expect(res.body).toHaveProperty('inferenceRules');
    expect(res.body).toHaveProperty('enhancements');
    expect(Array.isArray(res.body.teams)).toBe(true);
  });
});

describe('Enhancements CRUD', () => {
  const NAME = `__test_enh_${Date.now()}`;
  const RENAMED = `${NAME}_renamed`;
  const REC_ID = `ALC-TEST-ENH-${Date.now()}`;
  const cookie = () => makeAuthCookie(TEST_ADMIN.id, TEST_ADMIN.roles);
  let createdId = 0;

  afterAll(async () => {
    await prisma.allocationRecord.deleteMany({ where: { id: REC_ID } });
    await prisma.enhancement.deleteMany({ where: { name: { in: [NAME, RENAMED] } } });
  });

  it('creates an enhancement as Admin', async () => {
    const res = await request(app)
      .post('/api/settings/enhancements')
      .set('Cookie', cookie())
      .send({ name: NAME });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(NAME);
    createdId = res.body.id;
  });

  it('rejects a non-Admin', async () => {
    const employeeCookie = jwt.sign(
      { sub: TEST_ADMIN.id, roles: ['Employee'], sessionId: ADMIN_SESSION },
      process.env.JWT_SECRET!,
      { expiresIn: 3600, algorithm: 'HS256' },
    );
    const res = await request(app)
      .post('/api/settings/enhancements')
      .set('Cookie', `auth_token=${employeeCookie}`)
      .send({ name: '__nope' });

    expect(res.status).toBe(403);
  });

  it('surfaces the roster on the snapshot', async () => {
    const res = await request(app).get('/api/settings').set('Cookie', cookie());
    expect(res.status).toBe(200);
    expect(res.body.enhancements.some((e: { name: string }) => e.name === NAME)).toBe(true);
  });

  it('cascades a rename onto AllocationActivity.enhancementTag', async () => {
    // A saved card carrying the old name. Without the cascade this row would
    // be stranded on a tag no longer on the roster and would drop out of its
    // Finance bucket — the ghost-category bug.
    await prisma.allocationRecord.create({
      data: {
        id: REC_ID,
        employeeId: TEST_ADMIN.id,
        team: 'IT/Platforms',
        // Period deliberately unique to this file. Vitest runs test FILES in
        // parallel against one dev database, so sharing "March 2099" with
        // financeExport.test.ts made this fixture leak into its row counts.
        month: 'January',
        year: '2097',
        monthIndex: 0,
        status: 'Draft',
        activities: {
          create: [
            {
              streamCategory: 'Geniisys',
              subCategory: null,
              workType: 'Specific Enhancement',
              enhancementTag: NAME,
              client: 'AUII',
              description: 'test row',
              percentage: 100,
              streamOrder: 0,
              activityOrder: 0,
            },
          ],
        },
      },
    });

    const res = await request(app)
      .put(`/api/settings/enhancements/${createdId}`)
      .set('Cookie', cookie())
      .send({ name: RENAMED });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(RENAMED);
    expect(res.body.activitiesRepointed).toBe(1);

    const still = await prisma.allocationActivity.count({ where: { enhancementTag: NAME } });
    expect(still).toBe(0);
    const moved = await prisma.allocationActivity.count({ where: { enhancementTag: RENAMED } });
    expect(moved).toBe(1);
  });

  it('refuses to delete while still in use', async () => {
    const res = await request(app)
      .delete(`/api/settings/enhancements/${createdId}`)
      .set('Cookie', cookie());

    expect(res.status).toBe(409);
    expect(res.body.inUse).toBe(1);
  });

  it('deletes once nothing references it', async () => {
    await prisma.allocationRecord.deleteMany({ where: { id: REC_ID } });

    const res = await request(app)
      .delete(`/api/settings/enhancements/${createdId}`)
      .set('Cookie', cookie());

    expect(res.status).toBe(204);
    const gone = await prisma.enhancement.findUnique({ where: { id: createdId } });
    expect(gone).toBeNull();
  });
});

describe('POST /api/settings/teams', () => {
  const TEST_TEAM = `__test_team_${Date.now()}`;

  afterAll(async () => {
    await prisma.team.deleteMany({ where: { name: TEST_TEAM } });
  });

  it('creates a team when called by an Admin', async () => {
    const cookie = makeAuthCookie(TEST_ADMIN.id, TEST_ADMIN.roles);
    const res = await request(app)
      .post('/api/settings/teams')
      .set('Cookie', cookie)
      .send({ name: TEST_TEAM });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(TEST_TEAM);
  });

  it('returns 401 without auth on the snapshot too', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('returns 401 without auth on mutations', async () => {
    const res = await request(app)
      .post('/api/settings/teams')
      .send({ name: '__unauthorized' });

    expect(res.status).toBe(401);
  });

  it('returns 409 on duplicate team name', async () => {
    const cookie = makeAuthCookie(TEST_ADMIN.id, TEST_ADMIN.roles);
    // Second insert of the same name should conflict
    const res = await request(app)
      .post('/api/settings/teams')
      .set('Cookie', cookie)
      .send({ name: TEST_TEAM });

    expect(res.status).toBe(409);
  });
});
