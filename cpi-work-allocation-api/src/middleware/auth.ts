import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { SERVER_BOOT_TIME } from '../lib/bootTime.js';

export interface AuthRequest extends Request {
  userId?: string;
  /**
   * The user's roles, as carried in the JWT payload. Multi-role: a
   * user can have any combination of Employee / Manager / Finance /
   * Admin. Permission checks (requireRole) use intersection
   * semantics — any matching role grants access.
   */
  userRoles?: string[];
}

type JwtPayload = {
  sub: string;
  roles?: string[];
  // Legacy single-role JWTs issued before the multi-role migration.
  // Remove after the refresh-token TTL has elapsed (7 days post-deploy).
  role?: string;
  // Session lock: embedded at login, must match User.activeSessionId.
  sessionId?: string;
  iat?: number;
  exp?: number;
};

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  // ── Epic 2, Check A: Server Boot Invalidation ─────────────────────────────
  // Synchronous — no DB hit needed. Any token minted before this server
  // process started (e.g., yesterday's session after a nightly restart) is
  // instantly dead. iat is always present in our JWTs (jsonwebtoken stamps it
  // automatically when expiresIn is set).
  if (payload.iat !== undefined && payload.iat < SERVER_BOOT_TIME) {
    res.status(401).json({ error: 'Session invalidated by server restart. Please sign in again.' });
    return;
  }

  // Async DB checks (password staleness + session lock). We fire-and-forget
  // the promise here and handle all errors inside; Express's sync error
  // handler never sees this branch.
  void verifySessionAsync(req, res, next, payload);
}

async function verifySessionAsync(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  payload: JwtPayload,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        roles: true,
        passwordUpdatedAt: true,
        activeSessionId: true,
      },
    });

    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // ── Epic 2, Check B: Password Change Revocation ───────────────────────
    // If the token was issued before the last password change, it is
    // mathematically revoked. No token blocklist needed — the timestamp IS
    // the revocation record.
    if (payload.iat !== undefined) {
      const pwUpdatedSec = Math.floor(user.passwordUpdatedAt.getTime() / 1000);
      if (payload.iat < pwUpdatedSec) {
        res.status(401).json({ error: 'Session invalidated by password change. Please sign in again.' });
        return;
      }
    }

    // ── Epic 3 (Concurrent Session): Single-Session Lock ──────────────────
    // The sessionId embedded in the JWT must match what is stored in the DB.
    // A new login overwrites activeSessionId, so all previous tokens (on
    // other browsers / devices) fail this check immediately.
    if (payload.sessionId !== user.activeSessionId) {
      res.status(401).json({ error: 'Session superseded by a newer login. Please sign in again.' });
      return;
    }

    req.userId = payload.sub;
    if (Array.isArray(payload.roles)) {
      req.userRoles = payload.roles;
    } else if (typeof payload.role === 'string') {
      req.userRoles = [payload.role];
    } else {
      req.userRoles = [];
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * RBAC guard: allow the request if the user has ANY of the listed
 * roles. Multi-role users frequently match more than one allow-list
 * entry — that's expected (a [Admin, Manager] user accessing a route
 * that allows either).
 */
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRoles = req.userRoles ?? [];
    const allowed = userRoles.some((r) => roles.includes(r));
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
