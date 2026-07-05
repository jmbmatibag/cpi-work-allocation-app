import { getReportingPeriod } from 'cpi-work-allocation-shared';
import { prisma } from './prisma.js';
import { logAudit } from './audit.js';
import {
  sendNotificationEmail,
  resolveNotificationRecipient,
  buildSubmissionReminderEmailHtml,
  buildSubmissionReminderEmailText,
  buildPendingReviewReminderEmailHtml,
  buildPendingReviewReminderEmailText,
} from './mailer.js';

/**
 * Unified daily-until-done reminder cron.
 *
 * **Schedule.** Every workday (Mon–Fri), starting from the first
 * workday of the current calendar month. The "1st workday" framing in
 * the spec is the START boundary: any workday in the same month is by
 * definition on/after the 1st workday, so the runtime check reduces to
 * `isWorkday(today)`. If weekend delivery is ever wanted, flip
 * `shouldRunToday` to `() => true` — single-line change.
 *
 * **Period.** Reminders are about the CURRENT PERIOD, which is the
 * previous calendar month (the period being submitted *for*, not the
 * month the cron is firing *in*). In May the period is April. On the
 * 1st workday of June the period rolls forward to May.
 *
 * **Recipients.**
 *  - Employees: anyone with the Employee role who has either no
 *    allocation record for the period, or a record still in `Draft` or
 *    `NeedsRevision` (returned for revision — must resubmit). Excluded
 *    once they reach `PendingReview` or `Approved` — the Prisma NOT
 *    filter makes this exclusion explicit rather than implicit.
 *  - Managers: any manager who currently has at least one direct
 *    report with a `PendingReview` record for the period, grouped so
 *    each manager receives one consolidated email.
 *
 * **Idempotency.** One run per local calendar date. The job writes a
 * dated row to `AuditLog` (`entity=SystemJob`, `entityId=daily-reminder`,
 * `payload.date='YYYY-MM-DD'`) AFTER the loops; a crash mid-loop leaves
 * the slot un-claimed so the next hourly tick re-runs (one duplicate
 * email is strictly better than silently missing the rest of the loop).
 *
 * **Error boundary.** Each SMTP send is wrapped in try/catch — one
 * bad inbox can never abort the loop or crash the cron. The job
 * carries on, counts the failure, and reports both sent/failed totals
 * in the audit payload.
 *
 * **Relationship to the client-side hook.** `useNotificationScheduler`
 * still creates the in-app alert on the user's next login (its dedup
 * is keyed per calendar day, so the in-app alert is already daily for
 * a user who logs in). The cron owns SMTP delivery, which has to be
 * decoupled from "user happens to be logged in".
 */

const AUDIT_ENTITY = 'SystemJob';
const AUDIT_ENTITY_ID = 'daily-reminder';
const AUDIT_ACTION = 'run';

// ---------------------------------------------------------------------------
// Schedule predicates
// ---------------------------------------------------------------------------

/**
 * First Mon–Fri date of the month containing `ref`. Pure date math —
 * no holiday calendar. Sat 1st → Mon 3rd; Sun 1st → Mon 2nd; Mon 1st
 * → itself.
 */
export function firstWorkdayOfMonth(ref: Date): Date {
  const candidate = new Date(ref.getFullYear(), ref.getMonth(), 1);
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

export function isWorkday(ref: Date): boolean {
  const dow = ref.getDay();
  return dow !== 0 && dow !== 6;
}

/**
 * "Workday on/after the first workday of the month." Every workday in
 * a month is automatically >= the first workday of that month, so the
 * check collapses to a single `isWorkday`. Function kept for naming
 * clarity at the call site — the intent is "we are inside the active
 * reminder window for this month".
 */
export function shouldRunToday(ref: Date = new Date()): boolean {
  return isWorkday(ref);
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

interface Period {
  month: string;     // "January" … "December"
  year: string;      // "2026"
  monthIndex: number;
}

/**
 * The CURRENT PERIOD is the previous calendar month — the month whose
 * allocations are now due. Thin adapter over the shared
 * {@link getReportingPeriod} utility (the single source of truth for the
 * arrears rule); kept as a local name so the cron's call sites read in
 * domain terms. Drops the `label` field the shared type carries — the
 * cron formats its own subject lines from month+year.
 */
export function currentPeriod(ref: Date = new Date()): Period {
  const { month, year, monthIndex } = getReportingPeriod(ref);
  return { month, year, monthIndex };
}

// ---------------------------------------------------------------------------
// Daily dedup (one run per local calendar date)
// ---------------------------------------------------------------------------

function localDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function hasAlreadyRunToday(date: Date): Promise<boolean> {
  const prior = await prisma.auditLog.findFirst({
    where: {
      entity: AUDIT_ENTITY,
      entityId: AUDIT_ENTITY_ID,
      action: AUDIT_ACTION,
      payload: { path: ['date'], equals: localDateString(date) },
    },
    select: { id: true },
  });
  return prior !== null;
}

// ---------------------------------------------------------------------------
// Employee fan-out
// ---------------------------------------------------------------------------

interface FanOutResult {
  sent: number;
  failed: number;
  considered: number;
}

async function sendEmployeeReminders(period: Period): Promise<FanOutResult> {
  // Explicit exclusion: skip any employee who has already reached
  // PendingReview (submitted) or Approved for this period. Everyone
  // else — no record yet, Draft, or NeedsRevision (returned for
  // revision and still needs to resubmit) — is a valid reminder target.
  // Using NOT+some is intentionally explicit so adding a new status to
  // the enum never accidentally widens the audience; only statuses in
  // the exclusion list are safe to suppress.
  const pending = await prisma.user.findMany({
    where: {
      roles: { has: 'Employee' },
      // Respect the per-employee opt-out. Admins can exempt individuals
      // from automated reminders in the Employee Management view.
      emailNotificationsExempt: false,
      NOT: {
        allocations: {
          some: {
            month: period.month,
            year: period.year,
            status: { in: ['PendingReview', 'Approved'] },
          },
        },
      },
    },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  let sent = 0;
  let failed = 0;

  for (const emp of pending) {
    const recipient = resolveNotificationRecipient(emp.email);
    if (!recipient) {
      console.warn(
        `[reminders] skipping employee ${emp.id}: no email and no ` +
        `NOTIFICATION_FALLBACK_EMAIL set`,
      );
      continue;
    }
    const employeeName = `${emp.firstName} ${emp.lastName}`;
    try {
      await sendNotificationEmail(
        recipient,
        `[CPI Allocation] Action Required: Submit ${period.month} ${period.year} Work Allocation`,
        buildSubmissionReminderEmailHtml(employeeName, period.month, period.year),
        buildSubmissionReminderEmailText(employeeName, period.month, period.year),
      );
      sent += 1;
      console.log(
        `[reminders] submission reminder delivered to ${employeeName} <${recipient}>`,
      );
    } catch (err) {
      failed += 1;
      // Non-blocking: keep the loop going so one bad inbox can't
      // starve the rest of the org.
      console.warn(
        `[reminders] submission reminder to ${recipient} failed:`,
        (err as Error).message,
      );
    }
  }

  return { sent, failed, considered: pending.length };
}

// ---------------------------------------------------------------------------
// Manager fan-out (one consolidated email per manager)
// ---------------------------------------------------------------------------

interface ManagerBucket {
  managerId: string;
  managerName: string;
  managerEmail: string | null;
  pendingCount: number;
  employeeNames: string[];
}

async function bucketPendingByManager(period: Period): Promise<ManagerBucket[]> {
  const records = await prisma.allocationRecord.findMany({
    where: {
      status: 'PendingReview',
      month: period.month,
      year: period.year,
      managerId: { not: null },
      // Skip records whose manager has opted out of scheduled reminders.
      // Filters on the joined manager relation so an exempt manager gets
      // no pending-review email even while their reports' records stand.
      manager: { is: { emailNotificationsExempt: false } },
    },
    select: {
      managerId: true,
      employee: { select: { firstName: true, lastName: true } },
      manager:  { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ submittedAt: 'asc' }],
  });

  const buckets = new Map<string, ManagerBucket>();
  for (const r of records) {
    if (!r.managerId || !r.manager) continue;
    const employeeName = `${r.employee.firstName} ${r.employee.lastName}`;
    const existing = buckets.get(r.managerId);
    if (existing) {
      existing.pendingCount += 1;
      existing.employeeNames.push(employeeName);
    } else {
      buckets.set(r.managerId, {
        managerId: r.managerId,
        managerName: `${r.manager.firstName} ${r.manager.lastName}`,
        managerEmail: r.manager.email,
        pendingCount: 1,
        employeeNames: [employeeName],
      });
    }
  }
  return Array.from(buckets.values());
}

async function sendManagerReminders(period: Period): Promise<FanOutResult> {
  const buckets = await bucketPendingByManager(period);

  let sent = 0;
  let failed = 0;

  for (const bucket of buckets) {
    const recipient = resolveNotificationRecipient(bucket.managerEmail);
    if (!recipient) {
      console.warn(
        `[reminders] skipping manager ${bucket.managerId}: no email and no ` +
        `NOTIFICATION_FALLBACK_EMAIL set`,
      );
      continue;
    }
    try {
      await sendNotificationEmail(
        recipient,
        `[CPI Allocation] ${bucket.pendingCount} pending review${bucket.pendingCount === 1 ? '' : 's'} — ${period.month} ${period.year}`,
        buildPendingReviewReminderEmailHtml(
          bucket.managerName,
          period.month,
          period.year,
          bucket.pendingCount,
          bucket.employeeNames,
        ),
        buildPendingReviewReminderEmailText(
          bucket.managerName,
          period.month,
          period.year,
          bucket.pendingCount,
          bucket.employeeNames,
        ),
      );
      sent += 1;
      console.log(
        `[reminders] pending-review email delivered to ${bucket.managerName} ` +
        `<${recipient}> — ${bucket.pendingCount} item(s)`,
      );
    } catch (err) {
      failed += 1;
      console.warn(
        `[reminders] pending-review email to ${recipient} failed:`,
        (err as Error).message,
      );
    }
  }

  return { sent, failed, considered: buckets.length };
}

// ---------------------------------------------------------------------------
// Job entry point
// ---------------------------------------------------------------------------

export interface DailyReminderResult {
  ran: boolean;
  reason?: string;
  employees?: FanOutResult;
  managers?: FanOutResult;
}

export async function runDailyReminders(
  options: { force?: boolean; now?: Date } = {},
): Promise<DailyReminderResult> {
  const now = options.now ?? new Date();

  if (!options.force && !shouldRunToday(now)) {
    return { ran: false, reason: 'not a workday' };
  }
  if (!options.force && (await hasAlreadyRunToday(now))) {
    return { ran: false, reason: 'already ran today' };
  }

  const period = currentPeriod(now);
  console.log(
    `[reminders] running daily reminders for period ${period.month} ${period.year}`,
  );

  const employees = await sendEmployeeReminders(period);
  const managers = await sendManagerReminders(period);

  await logAudit({
    userId: null,
    action: AUDIT_ACTION,
    entity: AUDIT_ENTITY,
    entityId: AUDIT_ENTITY_ID,
    payload: {
      date: localDateString(now),
      period: { month: period.month, year: period.year },
      employeesNotified: employees.sent,
      employeesFailed: employees.failed,
      employeesConsidered: employees.considered,
      managersNotified: managers.sent,
      managersFailed: managers.failed,
      managersConsidered: managers.considered,
      runAt: now.toISOString(),
    },
  }).catch((e) => {
    // Audit failure logs but doesn't fail the job — emails already
    // went out, that's the user-visible outcome.
    console.warn('[reminders] audit stamp failed:', (e as Error).message);
  });

  return { ran: true, employees, managers };
}

// ---------------------------------------------------------------------------
// Scheduler bootstrap
// ---------------------------------------------------------------------------

// Hourly tick is the right cadence for a daily-resolution job: 24 cheap
// no-ops per day buys resilience against clock drift, missed midnight
// ticks during restarts, and timezone weirdness. The AuditLog dedup
// keeps repeated ticks within a day safe.
const TICK_MS = 60 * 60 * 1000;

export function startReminderScheduler(): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[reminders] scheduler disabled in non-production environment');
    return;
  }
  // Initial run on startup — covers the case where the server boots
  // mid-workday and would otherwise idle for an hour.
  runDailyReminders().catch((e) =>
    console.error('[reminders] initial run failed:', e),
  );
  setInterval(() => {
    runDailyReminders().catch((e) =>
      console.error('[reminders] scheduled run failed:', e),
    );
  }, TICK_MS).unref();
}
