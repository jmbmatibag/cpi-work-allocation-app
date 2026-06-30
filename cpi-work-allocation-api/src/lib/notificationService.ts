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
