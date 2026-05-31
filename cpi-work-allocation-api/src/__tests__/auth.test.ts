/**
 * Auth integration tests.
 *
 * These tests use the real database (dev DB) and real bcrypt, but mock the
 * mailer so no actual email is sent. A test user is inserted before the suite
 * and cleaned up after.
 *
 * Phase 5++: the auth flow is now two-step (password + OTP).
 *   1. POST /api/auth/login        { email, password }  →  OTP emailed
 *   2. POST /api/auth/verify-otp   { email, code }      →  cookies issued
 *
 * The test user is seeded with a known bcrypt hash so step 1 can pass.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

// ── Mock the mailer so OTP codes are captured instead of emailed ──────────────
let capturedOtp = '';

vi.mock('../lib/mailer.js', () => ({
  sendOtpEmail: vi.fn((_to: string, code: string) => {
    capturedOtp = code;
    return Promise.resolve();
  }),
  // employees.create + setup-password use these helpers — make them no-ops
  // for the auth suite so unrelated email sends don't pollute the captured
  // OTP variable.
  sendWelcomeEmail: vi.fn(() => Promise.resolve()),
  PASSWORD_SETUP_TTL_MS: 24 * 60 * 60 * 1000,
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_USER = {
  id:        'TEST_AUTH_001',
  firstName: 'Test',
  lastName:  'User',
  email:     'test.auth@cpi.com.ph',
  password:  'test_pass_123',
  roles:     ['Employee'] as ('Employee' | 'Manager' | 'Finance' | 'Admin')[],
  team:      'IT/Platforms',
  jobTitle:  'Tester',
};

const app = createApp();

beforeAll(async () => {
  const { password: _pw, ...fields } = TEST_USER;
  const passwordHash = await bcrypt.hash(_pw, 10);
  await prisma.user.upsert({
    where: { id: TEST_USER.id },
    create: { ...fields, passwordHash, managerId: null },
    update: { passwordHash, passwordSetupToken: null, passwordSetupExpiresAt: null },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: TEST_USER.id } });
  await prisma.$disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('triggers an OTP on valid email + password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/one-time code/i);
    expect(capturedOtp).toMatch(/^\d{6}$/);
  });

  it('returns generic 401 for an unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@cpi.com.ph', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it('returns generic 401 for a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USER.email, password: 'wrong_password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  it('rejects an invalid email shape with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'whatever' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/verify-otp', () => {
  it('rejects a wrong code with 401', async () => {
    // First trigger an OTP so a valid code exists
    await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: TEST_USER.email, code: '000000' });

    expect(res.status).toBe(401);
  });

  it('issues access + refresh cookies on correct code', async () => {
    // Trigger a fresh OTP
    await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ email: TEST_USER.email, code: capturedOtp });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id:        TEST_USER.id,
      email:     TEST_USER.email,
      firstName: TEST_USER.firstName,
      roles:     TEST_USER.roles,
    });

    // Both cookies must be present
    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : [String(raw)];
    expect(cookies.some((c) => c.startsWith('auth_token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
    // Cookies must be HttpOnly
    expect(cookies.every((c) => c.toLowerCase().includes('httponly'))).toBe(true);
  });
});

describe('POST /api/auth/setup-password', () => {
  it('rejects an unknown token with 400', async () => {
    const res = await request(app)
      .post('/api/auth/setup-password')
      .send({ token: 'definitely-not-a-real-token', password: 'StrongP@ssw0rd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it('rejects a weak password with 400', async () => {
    const res = await request(app)
      .post('/api/auth/setup-password')
      .send({ token: 'irrelevant', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('redeems a valid token and clears it', async () => {
    const token = 'test-setup-token-' + Date.now();
    const setupUser = {
      id: 'TEST_SETUP_001',
      firstName: 'Setup',
      lastName: 'User',
      email: 'test.setup@cpi.com.ph',
      roles: ['Employee'] as ('Employee' | 'Manager' | 'Finance' | 'Admin')[],
      team: 'IT/Platforms',
      jobTitle: 'Tester',
      managerId: null,
    };
    await prisma.user.upsert({
      where: { id: setupUser.id },
      create: {
        ...setupUser,
        passwordHash: null,
        passwordSetupToken: token,
        passwordSetupExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      update: {
        passwordHash: null,
        passwordSetupToken: token,
        passwordSetupExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    try {
      const res = await request(app)
        .post('/api/auth/setup-password')
        .send({ token, password: 'StrongP@ssw0rd1' });

      expect(res.status).toBe(200);

      // Token cleared, password hash now present
      const after = await prisma.user.findUnique({ where: { id: setupUser.id } });
      expect(after?.passwordSetupToken).toBeNull();
      expect(after?.passwordHash).toBeTruthy();
    } finally {
      await prisma.user.deleteMany({ where: { id: setupUser.id } });
    }
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 when no auth cookie is present', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
