/**
 * Scope helpers for multi-role users.
 *
 * Permissions are the UNION of a user's roles. A request is allowed on
 * a target if any of the user's roles grants access to it. The helpers
 * here centralize that union logic so controllers don't re-derive it.
 *
 * Scope precedence (broadest wins for grants, narrowest applies for
 * filters):
 *
 *   GLOBAL  — Admin / Finance can see everyone.
 *   TEAM    — Manager can see direct reports.
 *   SELF    — Employee can see their own records.
 *
 * A multi-role user gets the UNION: e.g. [Manager, Employee] sees
 * both their reports AND their own work; [Admin, Employee] sees
 * everyone (global subsumes self).
 */

import { prisma } from './prisma.js';

const GLOBAL_ROLES = ['Admin', 'Finance'];

export function hasGlobalScope(roles: readonly string[] | undefined): boolean {
  if (!roles) return false;
  return roles.some((r) => GLOBAL_ROLES.includes(r));
}

export function hasManagerScope(roles: readonly string[] | undefined): boolean {
  return !!roles && roles.includes('Manager');
}

export function hasEmployeeScope(roles: readonly string[] | undefined): boolean {
  return !!roles && roles.includes('Employee');
}

/**
 * True iff the requester (identified by userId + their roles) is
 * permitted to act on records belonging to `targetEmployeeId`.
 *
 * Used by single-record endpoints (getOne, submit, approve, edit, flag).
 * For list endpoints use {@link buildAllocationScopeFilter} instead.
 */
export async function canActOnEmployee(
  userId: string | undefined,
  userRoles: readonly string[] | undefined,
  targetEmployeeId: string,
): Promise<boolean> {
  if (!userId) return false;
  if (hasGlobalScope(userRoles)) return true;
  if (hasEmployeeScope(userRoles) && targetEmployeeId === userId) return true;
  if (hasManagerScope(userRoles)) {
    const isReport = await prisma.user.findFirst({
      where: { id: targetEmployeeId, managerId: userId },
      select: { id: true },
    });
    if (isReport) return true;
  }
  return false;
}

/**
 * Peer Coverage — true iff `a` and `b` are DISTINCT managers on the SAME
 * team. This is the eligibility rule for peer coverage: a manager may only
 * pin / act on peers who share their exact Team and also carry the Manager
 * role. Evaluated live against the User table so a subsequent team move
 * revokes coverage automatically.
 */
export async function arePeerManagers(
  a: string | undefined,
  b: string | undefined,
): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const [ua, ub] = await Promise.all([
    prisma.user.findUnique({ where: { id: a }, select: { team: true, roles: true } }),
    prisma.user.findUnique({ where: { id: b }, select: { team: true, roles: true } }),
  ]);
  if (!ua || !ub) return false;
  return (
    ua.team === ub.team &&
    ua.roles.includes('Manager') &&
    ub.roles.includes('Manager')
  );
}

/**
 * Permission gate for manager-side actions on a single allocation record
 * (approve / return / edit / flag) — now PEER-AWARE.
 *
 * Allowed when the caller:
 *   - has global scope (Admin / Finance), OR
 *   - is the record's assigned manager, OR
 *   - is a same-team peer manager of the record's assigned manager
 *     (Peer Coverage — they can fully action a peer's submissions).
 *
 * Async because the peer check reads the User table.
 */
export async function canManageAllocation(
  userId: string | undefined,
  userRoles: readonly string[] | undefined,
  recordManagerId: string | null,
): Promise<boolean> {
  if (hasGlobalScope(userRoles)) return true;
  if (!hasManagerScope(userRoles)) return false;
  if (recordManagerId && recordManagerId === userId) return true;
  if (!recordManagerId) return false;
  return arePeerManagers(userId, recordManagerId);
}

/**
 * Build the `where.employeeId` clause for list endpoints based on the
 * caller's scope. Returns `null` for global-scope callers — meaning no
 * employee filter at all.
 *
 * `requestedEmployeeId` is the optional ?employeeId= query param: if a
 * non-global caller asks for a specific employee, we validate that
 * employee is within their scope before honoring it (otherwise: 403).
 */
export async function buildAllocationScopeFilter(
  userId: string | undefined,
  userRoles: readonly string[] | undefined,
  requestedEmployeeId?: string,
): Promise<
  | { ok: true; filter: null }
  | { ok: true; filter: { employeeId: string } }
  | { ok: true; filter: { employeeId: { in: string[] } } }
  | { ok: true; filter: { OR: Array<{ employeeId: string } | { employeeId: { in: string[] } }> } }
  | { ok: false; status: 403 }
> {
  if (!userId) return { ok: false, status: 403 };

  // Global scope: see everyone. If a specific employee was requested,
  // narrow to that one; otherwise no filter at all.
  if (hasGlobalScope(userRoles)) {
    return requestedEmployeeId
      ? { ok: true, filter: { employeeId: requestedEmployeeId } }
      : { ok: true, filter: null };
  }

  const allowedIds = new Set<string>();
  if (hasEmployeeScope(userRoles)) allowedIds.add(userId);
  if (hasManagerScope(userRoles)) {
    const reports = await prisma.user.findMany({
      where: { managerId: userId },
      select: { id: true },
    });
    for (const r of reports) allowedIds.add(r.id);
  }

  if (allowedIds.size === 0) return { ok: false, status: 403 };

  // Narrow to a specific employee if asked, but only if it's in scope.
  if (requestedEmployeeId) {
    if (!allowedIds.has(requestedEmployeeId)) return { ok: false, status: 403 };
    return { ok: true, filter: { employeeId: requestedEmployeeId } };
  }

  // Multi-role users (Manager+Employee) end up with both self and
  // reports in the set; emit a single `in` clause.
  return { ok: true, filter: { employeeId: { in: Array.from(allowedIds) } } };
}
