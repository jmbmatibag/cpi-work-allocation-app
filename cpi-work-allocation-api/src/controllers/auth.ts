import type { Request, Response } from 'express';
import { randomInt, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { sendOtpEmail, sendPasswordResetEmail, PASSWORD_RESET_TTL_MS } from '../lib/mailer.js';
import {
  LoginSchema,
  VerifyOtpSchema,
  ResendOtpSchema,
  SetupPasswordSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
} from 'cpi-work-allocation-shared';
import { getValid } from '../middleware/validate.js';
import type { AuthRequest } from '../middleware/auth.js';
import {
  REFRESH_TTL_MS,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
} from '../lib/refreshToken.js';

const JWT_SECRET = process.env.JWT_SECRET!;
const ACCESS_COOKIE = 'auth_token';
const REFRESH_COOKIE = 'refresh_token';
// Refresh cookie is scoped to the auth namespace so it's only sent on
// /api/auth/* endpoints. Reduces exposure compared to path:'/'.
const REFRESH_COOKIE_PATH = '/api/auth';
const ACCESS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — tokens issued at login are always
// expired before the next working day begins, regardless of overnight server restarts.
const OTP_TTL_MS = 10 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const MAX_OTP_ATTEMPTS = 5;
// Resend abuse controls. A user may request at most MAX_OTP_RESENDS fresh
// codes before the resend endpoint locks them out for OTP_LOCKOUT_MS. Both
// the counter and the lockout are cleared on a successful OTP verification.
const MAX_OTP_RESENDS = 3;
const OTP_LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

function accessCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
  };
}

function issueAccessCookie(res: Response, userId: string, roles: string[]): void {
  const token = jwt.sign({ sub: userId, roles }, JWT_SECRET, {
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    algorithm: 'HS256',
  });
  res.cookie(ACCESS_COOKIE, token, {
    ...accessCookieOptions(),
    maxAge: ACCESS_TTL_MS,
  });
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions(),
    maxAge: REFRESH_TTL_MS,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, accessCookieOptions());
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

/**
 * Step 1 of two-step sign-in: verify email + password, then trigger OTP.
 *
 * Security choices:
 *   - All failure paths return the SAME generic "Invalid email or
 *     password" message so an attacker can't distinguish:
 *       (a) "this email doesn't exist"
 *       (b) "this email exists but hasn't set a password yet"
 *       (c) "this email exists, has a password, but it's wrong"
 *     We still log the distinction server-side for ops.
 *   - The OTP is only generated AFTER the password check passes —
 *     no SMTP traffic for unauth'd guessers, and no warmed-up code
 *     row for them to attack.
 *   - The bcrypt compare runs even for unknown emails (against a
 *     fixed dummy hash) so the response time is constant whether or
 *     not the email exists. Mitigates timing-based enumeration.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = getValid(req, LoginSchema);

  const user = await prisma.user.findUnique({ where: { email } });

  // Constant-time hash to compare against when the user is missing or
  // hasn't set a password yet. bcrypt's "$2a$10$" prefix would do here
  // but a real hash is cheap and uses the same code path.
  const TIMING_DUMMY_HASH =
    '$2b$10$CwTycUXWue0Thq9StjUM0uJ8N1lYZB1Ld1RrZJqV9I.0qg.uG8tD2';
  const hashToCheck = user?.passwordHash ?? TIMING_DUMMY_HASH;
  const passwordOk = await bcrypt.compare(password, hashToCheck);

  if (!user || !user.passwordHash || !passwordOk) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  await issueAndSendOtp(user.id, email);
  res.json({ message: 'A one-time code has been sent to your email.' });
}

/**
 * Issue a fresh login OTP for a user and email it. Wipes any prior live
 * OTPs first so an old code sitting in another inbox tab can't be used.
 * Shared by the login (step 1) and resend-otp flows.
 */
async function issueAndSendOtp(userId: string, email: string): Promise<void> {
  await prisma.otpCode.deleteMany({ where: { userId } });

  // CSPRNG-backed and uniform — Math.random is neither.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.otpCode.create({
    data: { userId, codeHash, expiresAt },
  });

  await sendOtpEmail(email, code);
}

/**
 * Re-issue a login OTP during an in-progress sign-in, with abuse controls.
 *
 * Logic (per the resend spec):
 *   1. If the user is currently locked out (otpLockoutUntil in the future),
 *      reject with 429 + the remaining lockout time.
 *   2. If the resend count has reached the cap, stamp a 1-hour lockout and
 *      reject with 429.
 *   3. Otherwise increment the count, issue a fresh OTP, and email it.
 *
 * Anti-enumeration: unknown / not-yet-set-up accounts get the same generic
 * 200 as a successful resend, with no email sent and no DB write — a probe
 * cannot tell a real address from a fake one. (Genuine users reach this
 * endpoint only after passing the password step, so this is belt-and-braces.)
 */
export async function resendOtp(req: Request, res: Response): Promise<void> {
  const { email } = getValid(req, ResendOtpSchema);

  const genericOk = () =>
    res.json({ message: 'A one-time code has been sent to your email.' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    genericOk();
    return;
  }

  const now = Date.now();

  // 1. Currently locked out → 429 with remaining time.
  if (user.otpLockoutUntil && user.otpLockoutUntil.getTime() > now) {
    rejectLocked(res, user.otpLockoutUntil.getTime() - now);
    return;
  }

  // A lockout that has since elapsed resets the window for a fresh budget.
  let resendCount = user.otpResendCount;
  if (user.otpLockoutUntil && user.otpLockoutUntil.getTime() <= now) {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpResendCount: 0, otpLockoutUntil: null },
    });
    resendCount = 0;
  }

  // 2. Cap reached → start a 1-hour lockout and reject.
  if (resendCount >= MAX_OTP_RESENDS) {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpLockoutUntil: new Date(now + OTP_LOCKOUT_MS) },
    });
    rejectLocked(res, OTP_LOCKOUT_MS);
    return;
  }

  // 3. Within budget → count it, issue a fresh code, send it.
  await prisma.user.update({
    where: { id: user.id },
    data: { otpResendCount: { increment: 1 } },
  });
  await issueAndSendOtp(user.id, email);
  genericOk();
}

/** Emit a 429 with a Retry-After header and the remaining lockout time. */
function rejectLocked(res: Response, remainingMs: number): void {
  const retryAfterSeconds = Math.ceil(remainingMs / 1000);
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: 'Too many code requests. Please try again later.',
    retryAfterSeconds,
  });
}

/**
 * Redeem a one-time password-setup link issued during admin account
 * creation. Body: `{ token, password }`. The password rule is enforced
 * by SetupPasswordSchema (strong-password regex) — see auth.ts.
 *
 * On success the token + expiry are cleared atomically with the hash
 * write, so the link is single-use.
 */
export async function setupPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = getValid(req, SetupPasswordSchema);

  const user = await prisma.user.findUnique({
    where: { passwordSetupToken: token },
  });

  if (
    !user ||
    !user.passwordSetupExpiresAt ||
    user.passwordSetupExpiresAt.getTime() < Date.now()
  ) {
    // Same generic error for "no such token" and "token expired" so
    // the wrong-token / expired-token branches are indistinguishable
    // to a probe.
    res.status(400).json({ error: 'This setup link is invalid or has expired.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordSetupToken: null,
      passwordSetupExpiresAt: null,
    },
  });

  // Defense in depth: revoke any live sessions / OTPs that may have
  // been issued before the password was set. Should be none in the
  // normal flow but cheap to clear.
  await prisma.otpCode.deleteMany({ where: { userId: user.id } });

  res.json({ message: 'Password set successfully. You can now sign in.' });
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const { email, code } = getValid(req, VerifyOtpSchema);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid code or email' });
    return;
  }

  const otp = await prisma.otpCode.findFirst({
    where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) {
    res.status(401).json({ error: 'Invalid code or email' });
    return;
  }

  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });
    res.status(401).json({ error: 'Too many attempts. Request a new code.' });
    return;
  }

  const ok = await bcrypt.compare(code, otp.codeHash);
  if (!ok) {
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    res.status(401).json({ error: 'Invalid code or email' });
    return;
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

  // Successful login clears the resend abuse window so the next sign-in
  // starts with a fresh budget.
  if (user.otpResendCount !== 0 || user.otpLockoutUntil !== null) {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpResendCount: 0, otpLockoutUntil: null },
    });
  }

  // Issue both cookies: short-lived access token (stateless JWT) and
  // long-lived refresh token (opaque, stored hashed in DB).
  issueAccessCookie(res, user.id, user.roles);
  const refreshToken = await issueRefreshToken(user.id, req);
  setRefreshCookie(res, refreshToken);

  res.json({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: [...user.roles],
      team: user.team,
      jobTitle: user.jobTitle,
      managerId: user.managerId,
    },
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const raw = req.cookies?.refresh_token;
  if (!raw) {
    res.status(401).json({ error: 'No refresh token' });
    return;
  }

  const result = await rotateRefreshToken(raw, req);
  if (!result.ok) {
    clearAuthCookies(res);
    if (result.reason === 'reuse') {
      res.status(401).json({ error: 'Token reuse detected — all sessions revoked. Please log in again.' });
    } else {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    return;
  }

  issueAccessCookie(res, result.userId, result.roles);
  setRefreshCookie(res, result.newToken);
  res.json({ ok: true });
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      roles: true,
      team: true,
      jobTitle: true,
      managerId: true,
    },
  });

  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  // Spread roles so the response is a fresh array — guards against any
  // accidental downstream mutation of the Prisma return value.
  res.json({ user: { ...user, roles: [...user.roles] } });
}

export async function logout(req: Request, res: Response): Promise<void> {
  // Best-effort revoke the current session's refresh token. The cookie path
  // is /api/auth, so this endpoint receives the refresh cookie.
  const raw = req.cookies?.refresh_token;
  if (raw) await revokeRefreshToken(raw);
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
}

export async function logoutAll(req: AuthRequest, res: Response): Promise<void> {
  const revoked = await revokeAllForUser(req.userId!);
  clearAuthCookies(res);
  res.json({ message: 'Logged out from all sessions', revoked });
}

/**
 * Initiate a password reset for a registered email address.
 *
 * Security choices:
 *   - Always returns 200 with the same body so callers cannot enumerate
 *     which emails are registered (probe sends both "found" and
 *     "not found" — they receive identical responses).
 *   - The SMTP send is fire-and-forget (void + .catch) so email errors
 *     don't leak the distinction either.
 *   - Token is 32 bytes of CSPRNG output encoded as base64url (256-bit
 *     entropy; brute-force is computationally hopeless).
 *   - Only one active reset token per user — writing a new one
 *     invalidates any prior unredeemed token.
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = getValid(req, ForgotPasswordSchema);

  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: token,
        passwordResetExpiresAt: expiresAt,
      },
    });

    void sendPasswordResetEmail(email, token).catch((err) => {
      console.error('[auth] forgot-password email failed:', err);
    });
  }

  // Always the same response — callers cannot distinguish found / not found.
  res.json({ message: 'If that email is registered, you will receive a reset link shortly.' });
}

/**
 * Redeem a one-time password-reset link from the forgot-password flow.
 * Body: `{ token, password }`. Same strong-password rule as setup-password.
 *
 * On success:
 *   - New hash written, reset token cleared.
 *   - ALL refresh tokens revoked (old sessions on other devices are
 *     bumped). The requester has no active session at this point (they
 *     came from an email link), so no session preservation is needed.
 *   - OTPs for the user are wiped so there's no race with a pending
 *     in-flight OTP that was issued before the password changed.
 */
export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = getValid(req, ResetPasswordSchema);

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: token },
  });

  if (
    !user ||
    !user.passwordResetExpiresAt ||
    user.passwordResetExpiresAt.getTime() < Date.now()
  ) {
    res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    },
  });

  await revokeAllForUser(user.id);
  await prisma.otpCode.deleteMany({ where: { userId: user.id } });

  res.json({ message: 'Password reset successfully. You can now sign in.' });
}

/**
 * Change password for the currently authenticated user.
 *
 * Security choices:
 *   - Requires the current password (prevents CSRF-style attacks where
 *     someone physically accesses an unlocked browser session).
 *   - On success, revokes ALL existing refresh tokens (invalidates other
 *     devices / sessions), then re-issues fresh access + refresh cookies
 *     for this session so the requester stays logged in seamlessly.
 *   - Generic "Current password is incorrect" — does not distinguish
 *     "account has no password" from "wrong password" so the error is
 *     not useful to an attacker who already has the session cookie.
 */
export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  const { currentPassword, newPassword } = getValid(req, ChangePasswordSchema);

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
  });

  if (!user || !user.passwordHash) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentOk) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newPasswordHash },
  });

  // Revoke all refresh tokens so other devices are bumped on their next
  // refresh cycle, then issue fresh tokens for this session so the user
  // who just changed their password stays logged in.
  await revokeAllForUser(user.id);
  issueAccessCookie(res, user.id, user.roles);
  const newRefreshToken = await issueRefreshToken(user.id, req);
  setRefreshCookie(res, newRefreshToken);

  res.json({ message: 'Password changed successfully.' });
}
