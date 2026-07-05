import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logAuditTx } from '../lib/audit.js';
import {
  sendWelcomeEmail,
  PASSWORD_SETUP_TTL_MS,
  EMAIL_BATCH_SIZE,
  EMAIL_BATCH_DELAY_MS,
} from '../lib/mailer.js';
import { processInBatches } from '../lib/batch.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  IdParamSchema,
  primaryRole,
  type UserRole,
} from 'cpi-work-allocation-shared';
import { toFrontendUser } from '../lib/mappers.js';

const PREFIX_BY_ROLE: Record<UserRole, string> = {
  Employee: 'EMP',
  Manager:  'MGR',
  Finance:  'FIN',
  Admin:    'ADM',
};

/**
 * Generate the next monotonic id for a user. The prefix is derived
 * from the user's highest-privilege role — so a multi-role user
 * [Admin, Manager, Employee] gets an ADM id, not three.
 */
function generateEmployeeId(roles: UserRole[], existingIds: string[]): string {
  const prefix = PREFIX_BY_ROLE[primaryRole(roles)];
  const nums = existingIds
    .filter((id) => id.startsWith(prefix))
    .map((id) => parseInt(id.slice(prefix.length), 10))
    .filter((n) => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function list(_req: Request, res: Response): Promise<void> {
  const users = await prisma.user.findMany({ orderBy: { lastName: 'asc' } });
  res.json(users.map(toFrontendUser));
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }
  res.json(toFrontendUser(user));
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  const { id: providedId, password, ...fields } = getValid(req, CreateEmployeeSchema);

  const existing = await prisma.user.findUnique({ where: { email: fields.email } });
  if (existing) {
    res.status(409).json({ error: 'EMAIL_IN_USE' });
    return;
  }

  if (fields.managerId) {
    const manager = await prisma.user.findUnique({ where: { id: fields.managerId } });
    if (!manager) {
      res.status(400).json({ error: 'INVALID_MANAGER' });
      return;
    }
    // Manager role check is set-membership now: the assigned manager must
    // include 'Manager' among their roles. A user can be (Admin + Manager
    // + Employee) and still be a valid manager for others.
    if (!manager.roles.includes('Manager')) {
      res.status(400).json({ error: 'MANAGER_ROLE_REQUIRED' });
      return;
    }
  }

  let id = providedId;
  if (!id) {
    const allIds = (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);
    id = generateEmployeeId(fields.roles, allIds);
  }

  // Two-step auth: admins do NOT choose the initial password. When the
  // caller doesn't supply one, the account is created with a null hash
  // and a one-time `passwordSetupToken` is mailed to the recipient. The
  // user redeems the link via POST /api/auth/setup-password to set their
  // own password. If the caller DOES supply an explicit password (rare —
  // typically only the seed/import path) we honor it and skip the
  // setup-token flow.
  let passwordHash: string | null = null;
  let setupToken: string | null = null;
  let setupExpiresAt: Date | null = null;

  if (password) {
    passwordHash = await bcrypt.hash(password, 10);
  } else {
    // URL-safe base64 of 32 random bytes — 256 bits of entropy. Brute
    // forcing in a 24-hour window is astronomically out of reach.
    setupToken = randomBytes(32).toString('base64url');
    setupExpiresAt = new Date(Date.now() + PASSWORD_SETUP_TTL_MS);
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id,
        passwordHash,
        passwordSetupToken: setupToken,
        passwordSetupExpiresAt: setupExpiresAt,
        firstName: fields.firstName,
        lastName: fields.lastName,
        email: fields.email,
        roles: fields.roles,
        team: fields.team,
        managerId: fields.managerId ?? null,
        jobTitle: fields.jobTitle,
      },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'create',
      entity: 'User',
      entityId: created.id,
      // Safe-field snapshot — never include passwordHash or setupToken.
      payload: {
        email: created.email,
        roles: [...created.roles],
        team: created.team,
        managerId: created.managerId,
        jobTitle: created.jobTitle,
        passwordSetupPending: setupToken !== null,
      },
    });
    return created;
  });

  // Fire-and-forget welcome email. Run AFTER the transaction commits so
  // a transient SMTP outage can't roll back account creation. Failures
  // are logged but never propagated to the response — an admin can
  // always re-trigger the email out-of-band if it bounces. If an admin
  // pre-set a password (no setupToken), we still send a welcome email
  // but with the login URL only (no setup link).
  if (setupToken) {
    void sendWelcomeEmail(
      user.email,
      `${user.firstName} ${user.lastName}`.trim() || user.email,
      setupToken,
    ).catch((err) => {
      console.error(
        `[employees.create] Welcome / setup email to ${user.email} failed:`,
        (err as Error).message,
      );
    });
  }

  res.status(201).json(toFrontendUser(user));
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');
  const input = getValid(req, UpdateEmployeeSchema);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  // Self-modification guard: the only role change that can lock the
  // requesting user out of the system is removing Admin from
  // themselves — Admin is the sole gate on the EmployeeManagement page
  // where roles can be re-granted. Adding/removing other roles is
  // harmless (Manager, Employee, etc. don't gate role administration).
  //
  // Multi-role: this MUST allow the common case of an Admin adding
  // Manager or Employee to themselves so they can also do day-to-day
  // work. The original strict-equality guard predates multi-role and
  // blocked that legitimate edit.
  if (
    req.userId === id &&
    input.roles &&
    target.roles.includes('Admin') &&
    !input.roles.includes('Admin')
  ) {
    res.status(400).json({
      error: 'CANNOT_REMOVE_OWN_ADMIN',
      message:
        'You cannot remove the Admin role from yourself. ' +
        'Ask another admin to do this.',
    });
    return;
  }

  if (input.email && input.email !== target.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email: input.email } });
    if (emailTaken) {
      res.status(409).json({ error: 'EMAIL_IN_USE' });
      return;
    }
  }

  if (input.managerId) {
    const manager = await prisma.user.findUnique({ where: { id: input.managerId } });
    if (!manager) {
      res.status(400).json({ error: 'INVALID_MANAGER' });
      return;
    }
    if (!manager.roles.includes('Manager')) {
      res.status(400).json({ error: 'MANAGER_ROLE_REQUIRED' });
      return;
    }
  }

  // Demotion guard: if the target currently has 'Manager' and the
  // incoming roles list drops it, refuse while reports still point
  // at them. Reassign-or-delete-reports-first is the expected flow.
  if (
    input.roles &&
    target.roles.includes('Manager') &&
    !input.roles.includes('Manager')
  ) {
    const reportCount = await prisma.user.count({ where: { managerId: target.id } });
    if (reportCount > 0) {
      res.status(400).json({ error: 'MANAGER_HAS_REPORTS' });
      return;
    }
  }

  const { password, roles, ...updateFields } = input;
  const data: Record<string, unknown> = { ...updateFields };
  if (roles) data.roles = { set: roles };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  // Redacted change-set: log which fields changed, with safe values, plus a
  // passwordChanged flag — never the password itself.
  const changes: Record<string, unknown> = { ...updateFields };
  if (roles) changes.roles = [...roles];
  if (password) changes.passwordChanged = true;

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id }, data });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'User',
      entityId: updated.id,
      payload: { changes },
    });
    return updated;
  });
  res.json(toFrontendUser(user));
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');

  if (req.userId === id) {
    res.status(400).json({ error: 'SELF_DELETE' });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }

  // Same demotion-style guard as update: a user with the Manager role
  // can't be deleted while reports point at them.
  if (target.roles.includes('Manager')) {
    const reportCount = await prisma.user.count({ where: { managerId: target.id } });
    if (reportCount > 0) {
      res.status(400).json({ error: 'MANAGER_HAS_REPORTS' });
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'delete',
      entity: 'User',
      entityId: id,
      payload: {
        email: target.email,
        roles: [...target.roles],
        team: target.team,
        managerId: target.managerId,
      },
    });
  });
  res.status(204).send();
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

const BulkIdsBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

/**
 * POST /api/employees/bulk-delete
 * Body: { ids: string[] }
 *
 * Applies the same guards as single `remove` to each id:
 *   - skips the requesting user's own id
 *   - skips managers who still have reports
 *
 * Returns a summary so the client can show which were deleted and which
 * were skipped with a reason, without requiring multiple round-trips.
 */
export async function bulkDelete(req: AuthRequest, res: Response): Promise<void> {
  const parse = BulkIdsBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  const { ids } = parse.data;

  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of ids) {
    if (req.userId === id) {
      skipped.push({ id, reason: 'Cannot delete your own account.' });
      continue;
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      skipped.push({ id, reason: 'Not found.' });
      continue;
    }

    if (target.roles.includes('Manager')) {
      const reportCount = await prisma.user.count({ where: { managerId: id } });
      if (reportCount > 0) {
        skipped.push({
          id,
          reason: `${target.firstName} ${target.lastName} has ${reportCount} direct ${reportCount === 1 ? 'report' : 'reports'}. Reassign first.`,
        });
        continue;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } });
      await logAuditTx(tx, {
        userId: req.userId!,
        action: 'delete',
        entity: 'User',
        entityId: id,
        payload: {
          email: target.email,
          roles: [...target.roles],
          team: target.team,
          managerId: target.managerId,
          bulkOp: true,
        },
      });
    });
    deleted.push(id);
  }

  res.json({ deleted, skipped });
}

/**
 * POST /api/employees/bulk-resend-welcome
 * Body: { ids: string[] }
 *
 * Re-issues the password-setup email for each employee whose account is
 * still in the setup-pending state (passwordHash === null). Employees
 * who have already completed setup are returned in `skipped`.
 *
 * A fresh 256-bit token is generated for each eligible user, replacing
 * the old one (expired or still valid). The 24-hour TTL is reset from now.
 */
export async function bulkResendWelcome(req: AuthRequest, res: Response): Promise<void> {
  const parse = BulkIdsBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  const { ids } = parse.data;

  const skipped: { id: string; reason: string }[] = [];
  // Eligible recipients whose setup token we (re)issue synchronously below.
  // We collect them first, then hand the actual SMTP sends to a throttled
  // batch processor. The previous implementation fired every
  // `sendWelcomeEmail` at once (fire-and-forget inside the loop), which
  // opened dozens of simultaneous SMTP connections and tripped Office 365's
  // "432 4.3.2 Concurrent connections limit exceeded".
  const outbox: { id: string; email: string; name: string; setupToken: string }[] = [];

  for (const id of ids) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      skipped.push({ id, reason: 'Not found.' });
      continue;
    }

    if (user.passwordHash) {
      skipped.push({
        id,
        reason: `${user.firstName} ${user.lastName} has already completed account setup.`,
      });
      continue;
    }

    // Regenerate setup token — replaces any existing (expired or live) token.
    const setupToken = randomBytes(32).toString('base64url');
    const setupExpiresAt = new Date(Date.now() + PASSWORD_SETUP_TTL_MS);

    await prisma.user.update({
      where: { id },
      data: { passwordSetupToken: setupToken, passwordSetupExpiresAt: setupExpiresAt },
    });

    outbox.push({
      id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      setupToken,
    });
  }

  // Send in throttled chunks AFTER responding. Tokens are already persisted,
  // so a late-arriving email is still valid and an admin can always
  // re-trigger. A full batched send of a 100-id blast (chunks of 3 with a
  // ~1.5s gap) can take ~50s — far too long to hold the HTTP request open —
  // so we fire-and-forget the batch, matching the endpoint's original
  // "queued" semantics while capping concurrency.
  void processInBatches(
    outbox,
    (r) => sendWelcomeEmail(r.email, r.name, r.setupToken),
    { batchSize: EMAIL_BATCH_SIZE, delayMs: EMAIL_BATCH_DELAY_MS },
  ).then((results) => {
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error(
          `[employees.bulkResendWelcome] Email to ${r.item.email} failed:`,
          (r.reason as Error)?.message ?? r.reason,
        );
      }
    }
  });

  res.json({ sent: outbox.map((r) => r.id), skipped });
}
