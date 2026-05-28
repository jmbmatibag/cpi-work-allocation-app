import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  /**
   * The user's roles, as carried in the JWT payload. Multi-role: a
   * user can have any combination of Employee / Manager / Head /
   * Finance / Admin. Permission checks (requireRole) use intersection
   * semantics — any matching role grants access.
   */
  userRoles?: string[];
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      sub: string;
      roles?: string[];
      // Legacy single-role JWTs issued before the multi-role migration —
      // accepted on first refresh so existing sessions aren't kicked out.
      // Remove after the refresh-token TTL has elapsed (7 days post-deploy).
      role?: string;
    };
    req.userId = payload.sub;
    if (Array.isArray(payload.roles)) {
      req.userRoles = payload.roles;
    } else if (typeof payload.role === 'string') {
      req.userRoles = [payload.role];
    } else {
      req.userRoles = [];
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
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
