import type { Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { logAuditTx } from '../lib/audit.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import {
  UpsertDraftSchema,
  ReturnForRevisionSchema,
  SubmitAllocationSchema,
  FlagActivitySchema,
  ManagerEditSchema,
  ListAllocationsQuerySchema,
  IdParamSchema,
  AllocationActivityParamsSchema,
} from 'cpi-work-allocation-shared';
import { toFrontendRecord, flattenStreams, StreamsInput } from '../lib/mappers.js';
import {
  sendNotificationEmail,
  resolveNotificationRecipient,
  buildSubmissionEmailHtml,
  buildSubmissionEmailText,
  buildApprovalEmailHtml,
  buildApprovalEmailText,
  buildRevisionEmailHtml,
  buildRevisionEmailText,
} from '../lib/mailer.js';
import {
  buildAllocationScopeFilter,
  canActOnEmployee,
  hasGlobalScope,
  hasManagerScope,
} from '../lib/scope.js';

const USER_PUBLIC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

const INCLUDE_FULL = {
  activities: true,
  employee: { select: USER_PUBLIC_SELECT },
  manager: { select: USER_PUBLIC_SELECT },
} as const;

function generateAllocationId(year: string): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ALC-${year}-${suffix}`;
}

export async function upsertDraft(req: AuthRequest, res: Response): Promise<void> {
  const d = getValid(req, UpsertDraftSchema);

  const allowed = await canActOnEmployee(req.userId, req.userRoles, d.employeeId);
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Derive managerId from the User table — never trust the client to route
  // their own approval. The client-supplied d.managerId is ignored.
  const targetEmployee = await prisma.user.findUnique({
    where: { id: d.employeeId },
    select: { managerId: true },
  });
  if (!targetEmployee) {
    res.status(404).json({ error: 'Employee not found' });
    return;
  }
  const managerId = targetEmployee.managerId;

  const existing = await prisma.allocationRecord.findUnique({
    where: { employeeId_month_year: { employeeId: d.employeeId, month: d.month, year: d.year } },
  });

  if (existing?.status === 'Approved') {
    res.status(409).json({ error: 'Cannot overwrite an approved allocation' });
    return;
  }

  // Always derive the id server-side. Never trust a client-supplied id on
  // create — accepting it gives the client a primary-key spoofing surface.
  const recordId = existing?.id ?? generateAllocationId(d.year);
  const activities = flattenStreams(d.streams as unknown as StreamsInput);

  const record = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.allocationActivity.deleteMany({ where: { recordId: existing.id } });
      await tx.allocationRecord.update({
        where: { id: existing.id },
        data: {
          team: d.team,
          managerId,
          monthIndex: d.monthIndex,
          activities: { create: activities },
        },
      });
      return tx.allocationRecord.findUnique({
        where: { id: existing.id },
        include: INCLUDE_FULL,
      });
    } else {
      return tx.allocationRecord.create({
        data: {
          id: recordId,
          employeeId: d.employeeId,
          team: d.team,
          managerId,
          month: d.month,
          year: d.year,
          monthIndex: d.monthIndex,
          status: 'Draft',
          activities: { create: activities },
        },
        include: INCLUDE_FULL,
      });
    }
  });

  res.status(existing ? 200 : 201).json(toFrontendRecord(record));
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
  const { employeeId, managerId, month, year, status } = getValid(
    req,
    ListAllocationsQuerySchema,
    'query'
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};

  // Scope filter derived from the caller's roles. Combines self
  // (Employee) and reports (Manager) into a single `in` clause for
  // multi-role users; returns no filter for global-scope users.
  const scope = await buildAllocationScopeFilter(req.userId, req.userRoles, employeeId);
  if (!scope.ok) {
    res.status(scope.status).json({ error: 'Forbidden' });
    return;
  }
  if (scope.filter) Object.assign(where, scope.filter);

  // managerId filter is a power-user feature — only honored for callers
  // with global scope. A scoped (Manager-only) caller can't filter by
  // another manager's id anyway: their scope is already their own reports.
  if (managerId && hasGlobalScope(req.userRoles)) where.managerId = managerId;
  if (month) where.month = month;
  if (year) where.year = year;
  if (status) where.status = status;

  const records = await prisma.allocationRecord.findMany({
    where,
    include: INCLUDE_FULL,
    orderBy: [{ year: 'desc' }, { monthIndex: 'desc' }],
  });

  res.json(records.map(toFrontendRecord));
}

export async function getOne(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');

  const record = await prisma.allocationRecord.findUnique({
    where: { id },
    include: INCLUDE_FULL,
  });

  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }

  const allowed = await canActOnEmployee(req.userId, req.userRoles, record.employeeId);
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  res.json(toFrontendRecord(record));
}

export async function submit(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');
  // Optional final streams payload — when provided, the activities are
  // replaced inside the same transaction as the status flip. Closes the
  // autosave-vs-submit race that caused submitted records to revert to
  // empty Draft on reload.
  const body = getValid(req, SubmitAllocationSchema);

  const record = await prisma.allocationRecord.findUnique({
    where: { id },
    include: INCLUDE_FULL,
  });
  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }

  // Submit is the employee's action — allow self (or global-scope
  // admins acting on behalf of an employee).
  if (!hasGlobalScope(req.userRoles) && record.employeeId !== req.userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (!['Draft', 'NeedsRevision'].includes(record.status)) {
    res.status(409).json({ error: `Cannot submit from status "${record.status}"` });
    return;
  }

  const activities = body.streams
    ? flattenStreams(body.streams as unknown as StreamsInput)
    : null;

  // Resolve the submitter's CURRENT manager from the User table at
  // submit time — not from `record.managerId`, which is stamped at
  // draft-creation and can be stale if the user's manager was
  // reassigned via the admin UI in between. Following the live
  // User.managerId chain also handles the case where a manager has
  // their own manager on top (notification follows the real chain).
  const submitter = await prisma.user.findUniqueOrThrow({
    where: { id: record.employeeId },
    select: {
      managerId: true,
      manager: { select: USER_PUBLIC_SELECT },
    },
  });
  const liveManagerId = submitter.managerId;
  const liveManager = submitter.manager;

  const updated = await prisma.$transaction(async (tx) => {
    // Bundle the live managerId refresh into the same transaction as
    // the status flip — keeps the record's manager pointer in sync
    // with the User table so Team Hub routing always reflects the
    // current org chart.
    const baseData = {
      status: 'PendingReview' as const,
      submittedAt: new Date(),
      managerId: liveManagerId,
    };
    if (activities) {
      // Replace activities atomically with the status flip so a
      // submitted record can never end up with stale or empty cards.
      await tx.allocationActivity.deleteMany({ where: { recordId: record.id } });
      await tx.allocationRecord.update({
        where: { id: record.id },
        data: { ...baseData, activities: { create: activities } },
      });
    } else {
      await tx.allocationRecord.update({
        where: { id: record.id },
        data: baseData,
      });
    }
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'submit',
      entity: 'AllocationRecord',
      entityId: record.id,
      payload: {
        fromStatus: record.status,
        toStatus: 'PendingReview',
        streamsCommitted: activities !== null,
        managerIdRefreshedTo: liveManagerId,
      },
    });
    return tx.allocationRecord.findUniqueOrThrow({
      where: { id: record.id },
      include: INCLUDE_FULL,
    });
  });

  res.json(toFrontendRecord(updated));

  // Notify the live manager that a new submission is waiting for
  // review. `liveManager` was resolved from the User table above so
  // the email follows the CURRENT org chart, not the record's
  // historical managerId. The env-var fallback covers the rare
  // genuinely-top-of-chain case (CEO submits with no manager set).
  // Fire-and-forget; failures are logged.
  const recipient = resolveNotificationRecipient(liveManager?.email);
  if (recipient) {
    const employeeName = `${updated.employee.firstName} ${updated.employee.lastName}`;
    const usedFallback = !liveManager?.email;
    sendNotificationEmail(
      recipient,
      `[CPI Allocation] ${employeeName} submitted ${updated.month} ${updated.year}`,
      buildSubmissionEmailHtml(employeeName, updated.month, updated.year, updated.id),
      buildSubmissionEmailText(employeeName, updated.month, updated.year),
    )
      .then(() => {
        if (usedFallback) {
          console.log(
            `[mailer] submission notification for record ${updated.id} delivered to ` +
            `fallback recipient (${recipient}); submitter ${updated.employeeId} has no ` +
            `manager assigned (top of reporting chain)`,
          );
        } else {
          console.log(
            `[mailer] submission notification for record ${updated.id} delivered to ` +
            `live manager ${liveManager?.id} (${recipient})`,
          );
        }
      })
      .catch((err) => {
        console.warn(
          `[mailer] submission notification to ${recipient} failed:`,
          (err as Error).message,
        );
      });
  } else {
    console.warn(
      `[mailer] submission notification skipped: submitter ${updated.employeeId} ` +
      `has no manager and NOTIFICATION_FALLBACK_EMAIL is not set`,
    );
  }
}

/**
 * Permission for manager-side actions (approve / return / edit / flag).
 *
 * Global-scope users (Admin/Head/Finance) can always act. Otherwise the
 * caller must have the Manager role AND be the record's assigned
 * manager. A multi-role [Manager, Employee] user editing one of their
 * reports' records hits the Manager branch (they ARE the assigned
 * manager); editing their OWN record bypasses this — managers approve
 * other people's work, not their own.
 */
function canManageRecord(
  userRoles: readonly string[] | undefined,
  userId: string | undefined,
  recordManagerId: string | null,
): boolean {
  if (hasGlobalScope(userRoles)) return true;
  if (hasManagerScope(userRoles) && recordManagerId === userId) return true;
  return false;
}

export async function approve(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');

  const record = await prisma.allocationRecord.findUnique({
    where: { id },
    include: INCLUDE_FULL,
  });
  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }

  if (!canManageRecord(req.userRoles, req.userId, record.managerId)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.allocationRecord.update({
      where: { id: record.id },
      data: { status: 'Approved', reviewedAt: new Date(), feedback: null },
      include: INCLUDE_FULL,
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'approve',
      entity: 'AllocationRecord',
      entityId: record.id,
      payload: { fromStatus: record.status, toStatus: 'Approved' },
    });
    return u;
  });

  res.json(toFrontendRecord(updated));

  // Notify the employee that their allocation was approved.
  if (updated.employee?.email) {
    const employeeName = `${updated.employee.firstName} ${updated.employee.lastName}`;
    sendNotificationEmail(
      updated.employee.email,
      `[CPI Allocation] Your ${updated.month} ${updated.year} allocation has been approved`,
      buildApprovalEmailHtml(employeeName, updated.month, updated.year, updated.id),
      buildApprovalEmailText(employeeName, updated.month, updated.year),
    ).catch((err) => {
      console.warn(
        `[mailer] approval notification to ${updated.employee.email} failed:`,
        (err as Error).message,
      );
    });
  }
}

export async function returnForRevision(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');
  const body = getValid(req, ReturnForRevisionSchema);

  const record = await prisma.allocationRecord.findUnique({
    where: { id },
    include: INCLUDE_FULL,
  });
  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }

  if (!canManageRecord(req.userRoles, req.userId, record.managerId)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.allocationRecord.update({
      where: { id: record.id },
      data: {
        status: 'NeedsRevision',
        reviewedAt: new Date(),
        feedback: body.feedback ?? null,
      },
      include: INCLUDE_FULL,
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'return',
      entity: 'AllocationRecord',
      entityId: record.id,
      payload: {
        fromStatus: record.status,
        toStatus: 'NeedsRevision',
        feedback: body.feedback ?? null,
      },
    });
    return u;
  });

  res.json(toFrontendRecord(updated));

  // Notify the employee that their allocation needs revision.
  if (updated.employee?.email) {
    const employeeName = `${updated.employee.firstName} ${updated.employee.lastName}`;
    sendNotificationEmail(
      updated.employee.email,
      `[CPI Allocation] Your ${updated.month} ${updated.year} allocation needs revision`,
      buildRevisionEmailHtml(employeeName, updated.month, updated.year, updated.id, body.feedback),
      buildRevisionEmailText(employeeName, updated.month, updated.year, body.feedback),
    ).catch((err) => {
      console.warn(
        `[mailer] revision notification to ${updated.employee.email} failed:`,
        (err as Error).message,
      );
    });
  }
}

export async function managerEdit(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');
  const body = getValid(req, ManagerEditSchema);

  const record = await prisma.allocationRecord.findUnique({ where: { id } });
  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }

  if (!canManageRecord(req.userRoles, req.userId, record.managerId)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Editor identity comes from the SESSION, never the request body — closes
  // the privilege-spoofing IDOR where a Manager could stamp edits as Admin.
  const editor = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId! },
    select: { id: true, firstName: true, lastName: true },
  });

  const activities = flattenStreams(body.streams as unknown as StreamsInput);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.allocationActivity.deleteMany({ where: { recordId: record.id } });
    await tx.allocationRecord.update({
      where: { id: record.id },
      data: {
        lastEditedByUserId: editor.id,
        lastEditedByUserName: `${editor.firstName} ${editor.lastName}`,
        lastEditedAt: new Date(),
        activities: { create: activities },
      },
    });
    await logAuditTx(tx, {
      userId: editor.id,
      action: 'manager-edit',
      entity: 'AllocationRecord',
      entityId: record.id,
      payload: { streams: body.streams, clearFlags: body.clearFlags },
    });
    return tx.allocationRecord.findUnique({
      where: { id: record.id },
      include: INCLUDE_FULL,
    });
  });

  res.json(toFrontendRecord(updated));
}

export async function flagActivity(req: AuthRequest, res: Response): Promise<void> {
  const { id, activityId } = getValid(req, AllocationActivityParamsSchema, 'params');
  const body = getValid(req, FlagActivitySchema);

  const record = await prisma.allocationRecord.findUnique({ where: { id } });
  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }
  if (!canManageRecord(req.userRoles, req.userId, record.managerId)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const activity = await prisma.allocationActivity.findFirst({
    where: { id: activityId, recordId: id },
  });
  if (!activity) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.allocationActivity.update({
      where: { id: activity.id },
      data: { flagReason: body.reason, flaggedAt: new Date() },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'flag',
      entity: 'AllocationActivity',
      entityId: activity.id,
      payload: { recordId: id, reason: body.reason },
    });
  });

  const updated = await prisma.allocationRecord.findUnique({
    where: { id },
    include: INCLUDE_FULL,
  });
  res.json(toFrontendRecord(updated));
}

export async function unflagActivity(req: AuthRequest, res: Response): Promise<void> {
  const { id, activityId } = getValid(req, AllocationActivityParamsSchema, 'params');

  const record = await prisma.allocationRecord.findUnique({ where: { id } });
  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }
  if (!canManageRecord(req.userRoles, req.userId, record.managerId)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const activity = await prisma.allocationActivity.findFirst({
    where: { id: activityId, recordId: id },
  });
  if (!activity) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.allocationActivity.update({
      where: { id: activity.id },
      data: { flagReason: null, flaggedAt: null },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'unflag',
      entity: 'AllocationActivity',
      entityId: activity.id,
      payload: { recordId: id },
    });
  });

  const updated = await prisma.allocationRecord.findUnique({
    where: { id },
    include: INCLUDE_FULL,
  });
  res.json(toFrontendRecord(updated));
}
