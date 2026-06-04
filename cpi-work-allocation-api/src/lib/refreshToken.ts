import { randomBytes, createHash } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from './prisma.js';
import { SERVER_BOOT_TIME } from './bootTime.js';

export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generate(): { token: string; hash: string } {
  // 64 bytes = 512 bits of entropy. base64url is URL- and cookie-safe.
  const token = randomBytes(64).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function captureClientFingerprint(req: Request): { userAgent: string | null; ip: string | null } {
  return {
    userAgent: req.get('user-agent') ?? null,
    ip: req.ip ?? null,
  };
}

export async function issueRefreshToken(userId: string, req: Request): Promise<string> {
  const { token, hash } = generate();
  const { userAgent, ip } = captureClientFingerprint(req);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent,
      ip,
    },
  });
  return token;
}

export type RotationOk = {
  ok: true;
  userId: string;
  roles: string[];
  newToken: string;
};

export type RotationError = {
  ok: false;
  reason: 'invalid' | 'expired' | 'reuse';
};

// Validate a refresh token and rotate it. If the token was already revoked,
// that's evidence of reuse — possible theft — and we revoke ALL of the user's
// active refresh tokens to force a full re-login.
//
// Known false-positive: if multiple browser tabs hit /refresh near-simultaneously
// with the same expired access token, one will succeed and the others will
// trigger reuse detection. Live with it as the cost of strong rotation.
export async function rotateRefreshToken(
  rawToken: string,
  req: Request
): Promise<RotationOk | RotationError> {
  const hash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: { select: { id: true, roles: true } } },
  });

  if (!existing) return { ok: false, reason: 'invalid' };

  // Server-boot invalidation: a refresh token created before this server
  // process started belongs to a previous run (yesterday's session). Treat
  // it as expired so the client is forced back to the login page.
  if (Math.floor(existing.createdAt.getTime() / 1000) < SERVER_BOOT_TIME) {
    return { ok: false, reason: 'expired' };
  }

  if (existing.revokedAt) {
    // Distinguish rotation-replay (theft signal) from logout-replay (benign):
    // only rotation sets replacedById. A logged-out token getting replayed
    // is just an expired session; don't fire the cascade-revoke alarm.
    if (existing.replacedById) {
      await prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: false, reason: 'reuse' };
    }
    return { ok: false, reason: 'invalid' };
  }

  if (existing.expiresAt < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  const { token: newToken, hash: newHash } = generate();
  const { userAgent, ip } = captureClientFingerprint(req);

  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent,
        ip,
      },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: created.id },
    });
  });

  return {
    ok: true,
    userId: existing.userId,
    roles: [...existing.user.roles],
    newToken,
  };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
