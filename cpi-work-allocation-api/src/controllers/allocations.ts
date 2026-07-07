import type { Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { logAuditTx } from '../lib/audit.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import {
  UpsertDraftSchema,
  ReturnForRevisionSchema,
  ApproveAllocationSchema,
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
  buildFinanceCompletionEmailHtml,
  buildFinanceCompletionEmailText,
} from '../lib/mailer.js';
import {
  createNotification,
  createNotificationsForUsers,
} from '../lib/notificationService.js';
import {
  buildAllocationScopeFilter,
  canActOnEmployee,
  canManageAllocation,
  arePeerManagers,
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

// Peer Coverage — the message returned when an approve/return loses the
// optimistic-concurrency check (another manager actioned the record first).
const CONCURRENT_ACTION_MESSAGE =
  'This allocation was already actioned by another manager.';

/**
 * Thrown inside the approve/return transaction when the guarded
 * `updateMany` matches zero rows — i.e. the record's status changed out
 * from under the caller between their page load and their click (a peer or
 * the direct manager got there first). Caught by the controller and mapped
 * to a 409 so the loser sees {@link CONCURRENT_ACTION_MESSAGE} instead of
 * silently overwriting the winner's decision.
 */
class ConcurrentActionError extends Error {}

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

  // managerId filter. Two ways it's honored:
  //   - Global-scope callers (Admin/Finance) can filter by ANY manager.
  //   - Peer Coverage: a Manager can filter by a SAME-TEAM peer manager
  //     (or themselves) to load that peer's Team Submissions. In that case
  //     we swap the self/reports employee scope for a manager-pointer scope
  //     — the covering manager is authorized to see exactly the records the
  //     peer owns for review. Any other managerId from a scoped caller is a
  //     403 (explicitly asking for out-of-scope data).
  if (managerId) {
    if (hasGlobalScope(req.userRoles)) {
      where.managerId = managerId;
    } else if (
      hasManagerScope(req.userRoles) &&
      (managerId === req.userId || (await arePeerManagers(req.userId, managerId)))
    ) {
      delete where.employeeId;
      where.managerId = managerId;
    } else {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }
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

  // Peer Coverage: the detail fetch must not be gated on the DIRECT
  // manager relationship. A caller may read this record if they can act on
  // the employee (self / direct manager / global) OR if they are a same-team
  // peer manager covering the record's assigned manager — the same authority
  // that lets them flag / return / approve it. Without the peer branch a
  // covering manager who deep-links to a submission gets a spurious 403.
  const allowed =
    (await canActOnEmployee(req.userId, req.userRoles, record.employeeId)) ||
    (await canManageAllocation(req.userId, req.userRoles, record.managerId));
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
  // In-app notification for the live manager (the bell). Independent of the
  // email send below — it lands even when the manager has no email on file,
  // and is keyed to the real manager id (not the env fallback recipient).
  if (liveManagerId) {
    const employeeName = `${updated.employee.firstName} ${updated.employee.lastName}`;
    void createNotification({
      targetUserId: liveManagerId,
      title: 'New Allocation Submission',
      message: `${employeeName} has submitted their allocation for ${updated.month} ${updated.year}.`,
      type: 'info',
      actionUrl: '/team-hub',
    });
  }

  const recipient = resolveNotificationRecipient(liveManager?.email);
  if (recipient) {
    const employeeName = `${updated.employee.firstName} ${updated.employee.lastName}`;
    const usedFallback = !liveManager?.email;
    sendNotificationEmail(
      recipient,
      `[CPI Allocation] ${employeeName} submitted ${updated.month} ${updated.year}`,
      buildSubmissionEmailHtml(employeeName, updated.month, updated.year),
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
 * Epic 3 — Automated Finance completion hook.
 *
 * Called fire-and-forget right after a manager approves an allocation.
 * Checks whether that approval was the LAST outstanding one for the
 * manager's team in this period; if so, notifies the Finance/Admin group
 * so they can start their accounting processes.
 *
 * `priorStatus` is the record's status BEFORE this approval. We bail when
 * it was already 'Approved' — re-approving an approved record must not
 * re-fire the notification (idempotency at the trigger edge).
 *
 * "Team complete" means every one of the manager's direct reports has an
 * Approved allocation for the period (100% overall progress) — NOT just that
 * the manager's review queue is empty. Reports who never submitted (Blank)
 * keep the team incomplete, so this fires only when the whole headcount is
 * approved.
 */
async function notifyFinanceIfTeamComplete(
  managerId: string | null,
  managerName: string | null,
  month: string,
  year: string,
  priorStatus: string,
): Promise<void> {
  if (!managerId) return; // top-of-chain record — no team to complete
  if (priorStatus === 'Approved') return; // not a real Draft/Pending→Approved transition

  // "Fully approved" must mean the WHOLE team is done — every person who
  // reports to this manager has an Approved allocation for the period — NOT
  // merely that the records which happen to exist are all approved. Counting
  // only existing records mis-fired this notice when most of the team never
  // submitted (Blank): one approved record looked like a cleared queue while
  // the team's overall progress was a fraction of 100%.
  //
  // Headcount mirrors the Master Overview's "Overall Progress" denominator:
  // direct reports, excluding Finance-only users (who aren't subjects of
  // allocation review).
  const reports = await prisma.user.findMany({
    where: { managerId },
    select: { id: true, roles: true },
  });
  const teamMemberIds = reports
    .filter((u) => !(u.roles.length === 1 && u.roles[0] === 'Finance'))
    .map((u) => u.id);
  if (teamMemberIds.length === 0) return; // no team to complete

  // How many of those reports have an Approved allocation for the period.
  const approvedCount = await prisma.allocationRecord.count({
    where: {
      employeeId: { in: teamMemberIds },
      month,
      year,
      status: 'Approved',
    },
  });

  // Not complete until EVERY report is approved (100% overall progress).
  if (approvedCount < teamMemberIds.length) return;

  const financeUsers = await prisma.user.findMany({
    where: { roles: { hasSome: ['Finance', 'Admin'] } },
    select: { id: true, email: true },
  });

  const resolvedName = managerName ?? 'A manager';
  const subject = `[CPI Allocation] ${resolvedName} fully approved ${month} ${year}`;
  const html = buildFinanceCompletionEmailHtml(resolvedName, month, year, approvedCount);
  const text = buildFinanceCompletionEmailText(resolvedName, month, year, approvedCount);

  // In-app bell notification for the whole Finance/Admin group.
  void createNotificationsForUsers(
    financeUsers.map((u) => u.id),
    {
      title: 'Team Allocations Fully Approved',
      message: `${resolvedName} has fully approved all Work Allocations for ${month} ${year}.`,
      type: 'success',
      actionUrl: '/master',
    },
  );

  // Collect distinct recipients. NOTIFICATION_FALLBACK_EMAIL covers the
  // case where the Finance group is empty / has no emails so the signal
  // never silently disappears.
  const recipients = new Set<string>();
  for (const u of financeUsers) {
    const r = resolveNotificationRecipient(u.email);
    if (r) recipients.add(r);
  }
  if (recipients.size === 0) {
    const fallback = resolveNotificationRecipient(null);
    if (fallback) recipients.add(fallback);
  }
  if (recipients.size === 0) {
    console.warn(
      `[mailer] team-complete notice skipped: no Finance/Admin recipients and ` +
      `NOTIFICATION_FALLBACK_EMAIL not set (manager ${managerId}, ${month} ${year})`,
    );
    return;
  }

  for (const recipient of recipients) {
    try {
      await sendNotificationEmail(recipient, subject, html, text);
      console.log(
        `[mailer] team-complete notice delivered to ${recipient} — ` +
        `${resolvedName} approved all ${month} ${year} allocations`,
      );
    } catch (err) {
      console.warn(
        `[mailer] team-complete notice to ${recipient} failed:`,
        (err as Error).message,
      );
    }
  }
}

export async function approve(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, IdParamSchema, 'params');
  const body = getValid(req, ApproveAllocationSchema);

  const record = await prisma.allocationRecord.findUnique({
    where: { id },
    include: INCLUDE_FULL,
  });
  if (!record) {
    res.status(404).json({ error: 'Allocation not found' });
    return;
  }

  if (!(await canManageAllocation(req.userId, req.userRoles, record.managerId))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Peer Coverage concurrency guard (fast path). If the client told us the
  // status it saw and the record has since moved on, another manager already
  // actioned it — bail before doing any work.
  if (body.expectedStatus && record.status !== body.expectedStatus) {
    res.status(409).json({ error: CONCURRENT_ACTION_MESSAGE });
    return;
  }

  // Capture the status BEFORE the approval so the Epic 3 completion hook
  // can tell a genuine →Approved transition from a redundant re-approval.
  const priorStatus = record.status;

  // Peer Coverage accountability — stamp the user who ACTUALLY approved.
  // Resolved from the session (never the body) so a covering peer is
  // recorded as the actor rather than the record's assigned manager.
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId! },
    select: { id: true, firstName: true, lastName: true },
  });
  const actorName = `${actor.firstName} ${actor.lastName}`;

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Concurrency guard (authoritative path). Scope the write to the
      // expected status so two managers clicking "Approve" at the same
      // instant can't both win: whoever commits first flips the status, and
      // the loser's updateMany matches zero rows. `updateMany` (not `update`)
      // because `update` throws on a where-miss with a status predicate;
      // count-zero lets us translate cleanly to a 409.
      const guard = body.expectedStatus ? { status: body.expectedStatus } : {};
      const result = await tx.allocationRecord.updateMany({
        where: { id: record.id, ...guard },
        data: {
          status: 'Approved',
          reviewedAt: new Date(),
          feedback: null,
          actionedById: actor.id,
          actionedByName: actorName,
          actionedAt: new Date(),
        },
      });
      if (result.count === 0) throw new ConcurrentActionError();

      await logAuditTx(tx, {
        userId: req.userId!,
        action: 'approve',
        entity: 'AllocationRecord',
        entityId: record.id,
        payload: { fromStatus: record.status, toStatus: 'Approved', actionedById: actor.id },
      });
      return tx.allocationRecord.findUniqueOrThrow({
        where: { id: record.id },
        include: INCLUDE_FULL,
      });
    });
  } catch (err) {
    if (err instanceof ConcurrentActionError) {
      res.status(409).json({ error: CONCURRENT_ACTION_MESSAGE });
      return;
    }
    throw err;
  }

  res.json(toFrontendRecord(updated));

  // In-app notification for the employee whose allocation was approved.
  void createNotification({
    targetUserId: updated.employeeId,
    title: 'Allocation Approved',
    message: `Your work allocation for ${updated.month} ${updated.year} has been approved.`,
    type: 'success',
    actionUrl: '/allocations',
  });

  // Notify the employee that their allocation was approved. The actor name
  // (who ACTUALLY clicked Approve) is injected so a peer-covered approval
  // reads "approved by <peer>" rather than implying the direct manager did it.
  if (updated.employee?.email) {
    const employeeName = `${updated.employee.firstName} ${updated.employee.lastName}`;
    sendNotificationEmail(
      updated.employee.email,
      `[CPI Allocation] Your ${updated.month} ${updated.year} allocation has been approved`,
      buildApprovalEmailHtml(employeeName, updated.month, updated.year, actorName),
      buildApprovalEmailText(employeeName, updated.month, updated.year, actorName),
    ).catch((err) => {
      console.warn(
        `[mailer] approval notification to ${updated.employee.email} failed:`,
        (err as Error).message,
      );
    });
  }

  // Epic 3: if this approval cleared the manager's entire review queue for
  // the period, tell Finance/Admin so accounting can begin. Fire-and-forget
  // — a notification failure must never fail the approval the user just made.
  const managerName = updated.manager
    ? `${updated.manager.firstName} ${updated.manager.lastName}`
    : null;
  notifyFinanceIfTeamComplete(
    updated.managerId,
    managerName,
    updated.month,
    updated.year,
    priorStatus,
  ).catch((err) => {
    console.warn(
      `[mailer] team-complete check failed for manager ${updated.managerId}:`,
      (err as Error).message,
    );
  });
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

  if (!(await canManageAllocation(req.userId, req.userRoles, record.managerId))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Peer Coverage concurrency guard (fast path) — see approve() for rationale.
  if (body.expectedStatus && record.status !== body.expectedStatus) {
    res.status(409).json({ error: CONCURRENT_ACTION_MESSAGE });
    return;
  }

  // Peer Coverage accountability — stamp the user who ACTUALLY returned it.
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId! },
    select: { id: true, firstName: true, lastName: true },
  });
  const actorName = `${actor.firstName} ${actor.lastName}`;

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Concurrency guard (authoritative path) — scope the write to the
      // expected status so a simultaneous approve/return can't both land.
      const guard = body.expectedStatus ? { status: body.expectedStatus } : {};
      const result = await tx.allocationRecord.updateMany({
        where: { id: record.id, ...guard },
        data: {
          status: 'NeedsRevision',
          reviewedAt: new Date(),
          feedback: body.feedback ?? null,
          actionedById: actor.id,
          actionedByName: actorName,
          actionedAt: new Date(),
        },
      });
      if (result.count === 0) throw new ConcurrentActionError();

      await logAuditTx(tx, {
        userId: req.userId!,
        action: 'return',
        entity: 'AllocationRecord',
        entityId: record.id,
        payload: {
          fromStatus: record.status,
          toStatus: 'NeedsRevision',
          feedback: body.feedback ?? null,
          actionedById: actor.id,
        },
      });
      return tx.allocationRecord.findUniqueOrThrow({
        where: { id: record.id },
        include: INCLUDE_FULL,
      });
    });
  } catch (err) {
    if (err instanceof ConcurrentActionError) {
      res.status(409).json({ error: CONCURRENT_ACTION_MESSAGE });
      return;
    }
    throw err;
  }

  res.json(toFrontendRecord(updated));

  // In-app notification for the employee whose allocation needs revision.
  void createNotification({
    targetUserId: updated.employeeId,
    title: 'Revision Requested',
    message:
      `Your work allocation for ${updated.month} ${updated.year} requires changes.` +
      (body.feedback ? ` Reason: ${body.feedback}` : ''),
    type: 'warning',
    actionUrl: '/allocations',
  });

  // Notify the employee that their allocation needs revision. The actor name
  // (who ACTUALLY returned it) is injected so the notice names the reviewing
  // peer rather than implying the direct manager sent it back.
  if (updated.employee?.email) {
    const employeeName = `${updated.employee.firstName} ${updated.employee.lastName}`;
    sendNotificationEmail(
      updated.employee.email,
      `[CPI Allocation] Your ${updated.month} ${updated.year} allocation needs revision`,
      buildRevisionEmailHtml(employeeName, updated.month, updated.year, body.feedback, actorName),
      buildRevisionEmailText(employeeName, updated.month, updated.year, body.feedback, actorName),
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

  if (!(await canManageAllocation(req.userId, req.userRoles, record.managerId))) {
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
  if (!(await canManageAllocation(req.userId, req.userRoles, record.managerId))) {
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
  if (!(await canManageAllocation(req.userId, req.userRoles, record.managerId))) {
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
