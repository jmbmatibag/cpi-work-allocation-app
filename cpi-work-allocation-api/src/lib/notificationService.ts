import { prisma } from './prisma.js';
import type { NotificationType } from '../generated/prisma/client.js';

/**
 * Server-side in-app notification service (the bell UI's source of truth).
 *
 * Notifications used to live only in the browser's localStorage, which
 * meant the backend couldn't create them and they never reached the user
 * an event actually concerned (a manager's "new submission", an employee's
 * "approved"). This service is the DB-backed replacement: workflow events
 * create rows here and the frontend reads them over the API.
 *
 * Every create is best-effort and non-blocking at the call site — a
 * notification write must never fail the mutation that triggered it. Errors
 * are swallowed-with-a-log here so callers can `void` the promise.
 */

export interface CreateNotificationInput {
  targetUserId: string;
  title: string;
  message: string;
  type?: NotificationType;
  actionUrl?: string | null;
}

/** Create one notification. Resolves to the row, or null on failure. */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ id: string } | null> {
  try {
    return await prisma.notification.create({
      data: {
        targetUserId: input.targetUserId,
        title: input.title,
        message: input.message,
        type: input.type ?? 'info',
        actionUrl: input.actionUrl ?? null,
      },
      select: { id: true },
    });
  } catch (err) {
    console.warn(
      `[notifications] failed to create notification for ${input.targetUserId}:`,
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Fan a single notification out to many recipients in one write. Used by
 * the Finance/Admin group notice (Epic 3). Skips silently if the id list is
 * empty. Best-effort like {@link createNotification}.
 */
export async function createNotificationsForUsers(
  targetUserIds: string[],
  notification: Omit<CreateNotificationInput, 'targetUserId'>,
): Promise<number> {
  const ids = Array.from(new Set(targetUserIds));
  if (ids.length === 0) return 0;
  try {
    const result = await prisma.notification.createMany({
      data: ids.map((targetUserId) => ({
        targetUserId,
        title: notification.title,
        message: notification.message,
        type: notification.type ?? 'info',
        actionUrl: notification.actionUrl ?? null,
      })),
    });
    return result.count;
  } catch (err) {
    console.warn(
      `[notifications] failed to fan out notification to ${ids.length} users:`,
      (err as Error).message,
    );
    return 0;
  }
}

/** Newest-first notifications for a user. `limit` caps the payload size. */
export function listForUser(userId: string, limit = 100) {
  return prisma.notification.findMany({
    where: { targetUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Mark one notification read — scoped to the owner so a user can never
 * flip another user's notification. Returns the number of rows updated
 * (0 = not found or not owned).
 */
export async function markRead(userId: string, id: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { id, targetUserId: userId },
    data: { isRead: true },
  });
  return result.count;
}

/** Mark every unread notification for a user read. Returns rows updated. */
export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { targetUserId: userId, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}

/**
 * Content token every "please submit your allocation" reminder embeds — the
 * stable phrase the client scheduler writes (`useNotificationScheduler`) and
 * the anchor we match on for cleanup. The `Notification` table carries no
 * structured allocation/period linkage (title + message only), so a reminder
 * can only be tied back to its allocation by the phrase + the "{Month} {Year}"
 * period token both live in the message body.
 */
const SUBMIT_REMINDER_TOKEN = 'submit your work allocation';

/**
 * Epic 2 — clear stale "Action Required: submit your allocation" reminders the
 * moment the underlying allocation stops needing a submit (it was approved, or
 * — see the submit handler — the employee has now submitted it).
 *
 * Scoped THREE ways so it can never clear an unrelated nudge:
 *   1. `targetUserId` — only this employee's tray.
 *   2. the submit-reminder phrase — never touches manager "Pending Actions"
 *      or the Finance "Overdue Work Allocations" reminder, which are about a
 *      whole team, not this one allocation.
 *   3. the "{Month} {Year}" period token — reminders for other periods stand.
 *
 * Best-effort: a cleanup failure must never fail the approval/submit that
 * triggered it, so the error is swallowed-with-a-log and the caller `void`s it.
 * Returns the number of reminders cleared.
 */
export async function markSubmitRemindersRead(
  targetUserId: string,
  month: string,
  year: string,
): Promise<number> {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        targetUserId,
        isRead: false,
        // Both tokens must be present. Prisma requires distinct `message`
        // predicates to be ANDed explicitly (one key per object).
        AND: [
          { message: { contains: SUBMIT_REMINDER_TOKEN } },
          { message: { contains: `${month} ${year}` } },
        ],
      },
      data: { isRead: true },
    });
    return result.count;
  } catch (err) {
    console.warn(
      `[notifications] failed to clear submit reminders for ${targetUserId} ` +
      `(${month} ${year}):`,
      (err as Error).message,
    );
    return 0;
  }
}
