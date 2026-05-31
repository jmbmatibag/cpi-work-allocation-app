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

// Build a valid auth_token cookie for the test admin
function makeAuthCookie(userId: string, roles: string[]): string {
  const token = jwt.sign({ sub: userId, roles }, process.env.JWT_SECRET!, {
    expiresIn: 3600,
    algorithm: 'HS256',
  });
  return `auth_token=${token}`;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('test', 10);
  await prisma.user.upsert({
    where: { id: TEST_ADMIN.id },
    create: { ...TEST_ADMIN, passwordHash, managerId: null },
    update: {},
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
    expect(Array.isArray(res.body.teams)).toBe(true);
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
