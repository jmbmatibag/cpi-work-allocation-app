import type { Response } from 'express';
import { z } from 'zod';
import { getReportingPeriod } from 'cpi-work-allocation-shared';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import {
  sendNotificationEmail,
  resolveNotificationRecipient,
  buildManualReminderEmailHtml,
  buildManualReminderEmailText,
} from '../lib/mailer.js';
import {
  createNotification,
  listForUser,
  markRead as markReadSvc,
  markAllRead as markAllReadSvc,
} from '../lib/notificationService.js';

/**
 * Body schema for POST /api/notifications/manual-reminder.
 * Exported so the route can mount validate(ManualReminderSchema) and the
 * controller can read it back type-safely via getValid().
 */
export const ManualReminderSchema = z.object({
  managerIds: z.array(z.string().min(1)).min(1).max(200),
  // Period is OPTIONAL. When omitted the controller falls back to the
  // canonical reporting period (previous calendar month) via
  // getReportingPeriod(). An explicit month/year is still honored so
  // Finance can chase a specific older overdue period from the picker.
  month: z.string().min(1).optional(),
  year: z.string().min(1).optional(),
});

/**
 * Body schema for POST /api/notifications — the SELF-create endpoint used
 * by the client-side login scheduler. `targetUserId` is intentionally NOT
 * accepted from the body: the controller forces it to the authenticated
 * user so a client can never mint notifications for someone else. Cross-user
 * notifications are created server-side by the workflow handlers instead.
 */
export const CreateSelfNotificationSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  type: z.enum(['info', 'success', 'warning', 'error']).optional(),
  actionUrl: z.string().max(500).optional(),
});

/** Param schema for PATCH /api/notifications/:id/read. */
export const NotificationIdParamSchema = z.object({
  id: z.string().min(1),
});

// ── Read endpoints ──────────────────────────────────────────────────────────

/** GET /api/notifications — the caller's own notifications, newest first. */
export async function list(req: AuthRequest, res: Response): Promise<void> {
  const rows = await listForUser(req.userId!);
  res.json(rows);
}

/** POST /api/notifications — create a notification for YOURSELF only. */
export async function createSelf(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, CreateSelfNotificationSchema);
  const created = await createNotification({
    targetUserId: req.userId!,
    title: body.title,
    message: body.message,
    type: body.type ?? 'info',
    actionUrl: body.actionUrl ?? null,
  });
  if (!created) {
    res.status(500).json({ error: 'Failed to create notification' });
    return;
  }
  res.status(201).json(created);
}

/** PATCH /api/notifications/:id/read — mark one of the caller's read. */
export async function markRead(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NotificationIdParamSchema, 'params');
  const updated = await markReadSvc(req.userId!, id);
  if (updated === 0) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }
  res.json({ ok: true });
}

/** POST /api/notifications/read-all — mark all the caller's read. */
export async function markAllRead(req: AuthRequest, res: Response): Promise<void> {
  const count = await markAllReadSvc(req.userId!);
  res.json({ ok: true, updated: count });
}

const STATUSES_NEEDING_ACTION = [
  'Draft',
  'PendingReview',
  'NeedsRevision',
] as const;

/**
 * Manual reminder dispatch (Epic 2).
 *
 * Finance selects managers whose teams are not 100% approved for a period
 * and fires this endpoint with their ids. For each manager we resolve a
 * recipient email (with the NOTIFICATION_FALLBACK_EMAIL safety net),
 * count their still-outstanding allocations for the period so the email
 * can quote a real number, and send the overdue-reminder template.
 *
 * One bad inbox never aborts the batch — failures are collected into
 * `skipped` and the loop carries on, mirroring the daily reminder cron.
 */
export async function manualReminder(req: AuthRequest, res: Response): Promise<void> {
  const { managerIds, month: bodyMonth, year: bodyYear } = getValid(req, ManualReminderSchema);

  // Inject the global arrears rule: the period is authoritatively the
  // reporting period (previous calendar month). An explicit body period
  // overrides only when the client deliberately sends one. So if Finance
  // fires this on June 10th with no period, we definitively query —
  // and email about — "May 2026".
  const reportingPeriod = getReportingPeriod();
  const month = bodyMonth ?? reportingPeriod.month;
  const year = bodyYear ?? reportingPeriod.year;

  // De-dupe ids defensively (the UI shouldn't send dupes, but the count
  // queries below would double-email if it did).
  const uniqueIds = Array.from(new Set(managerIds));

  const managers = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const managerById = new Map(managers.map((m) => [m.id, m]));

  const sent: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of uniqueIds) {
    const mgr = managerById.get(id);
    if (!mgr) {
      skipped.push({ id, reason: 'manager not found' });
      continue;
    }

    const recipient = resolveNotificationRecipient(mgr.email);
    if (!recipient) {
      skipped.push({ id, reason: 'no email on file' });
      continue;
    }

    // Outstanding = allocations this manager owns for the period that
    // still need action. Quoted in the email body.
    const pendingCount = await prisma.allocationRecord.count({
      where: {
        managerId: id,
        month,
        year,
        status: { in: [...STATUSES_NEEDING_ACTION] },
      },
    });

    const managerName = `${mgr.firstName} ${mgr.lastName}`;
    try {
      await sendNotificationEmail(
        recipient,
        `Action Required: Urgent - Overdue CPI Work Allocations for ${month} ${year}`,
        buildManualReminderEmailHtml(managerName, month, year, pendingCount),
        buildManualReminderEmailText(managerName, month, year, pendingCount),
      );
      sent.push(id);
      // Also drop an in-app notification into the manager's bell so the
      // reminder is visible next time they log in, not just in email.
      void createNotification({
        targetUserId: id,
        title: 'Action Required: Overdue Work Allocations',
        message:
          `Finance has flagged ${pendingCount} outstanding work allocation${
            pendingCount === 1 ? '' : 's'
          } for ${month} ${year}. Please review and approve your team's submissions.`,
        type: 'warning',
        actionUrl: '/team-hub',
      });
      console.log(
        `[notifications] manual reminder delivered to ${managerName} <${recipient}> ` +
        `for ${month} ${year} (${pendingCount} pending)`,
      );
    } catch (err) {
      skipped.push({ id, reason: (err as Error).message });
      console.warn(
        `[notifications] manual reminder to ${recipient} failed:`,
        (err as Error).message,
      );
    }
  }

  await logAudit({
    userId: req.userId ?? null,
    action: 'manual-reminder',
    entity: 'Notification',
    entityId: `${month}-${year}`,
    payload: {
      period: { month, year },
      requested: uniqueIds.length,
      sent: sent.length,
      skipped: skipped.length,
    },
  }).catch((e) => {
    console.warn('[notifications] audit stamp failed:', (e as Error).message);
  });

  res.json({ sent, skipped });
}
