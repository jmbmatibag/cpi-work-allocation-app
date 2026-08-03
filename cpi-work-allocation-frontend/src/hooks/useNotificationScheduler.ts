import { useEffect, useRef } from "react";
import { getReportingPeriod } from "cpi-work-allocation-shared";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAllocations,
  type AllocationStatus,
} from "@/contexts/AllocationsContext";
import { useEmployees } from "@/contexts/EmployeesContext";
import { useNotifications } from "@/contexts/NotificationsContext";

/**
 * Statuses that mean an employee's submit action is DONE for the period, so
 * no "please submit" reminder should fire. This is the frontend mirror of the
 * backend email cron's exclusion list — `sendEmployeeReminders` in
 * `cpi-work-allocation-api/src/lib/reminderScheduler.ts` excludes
 * `{ in: ['PendingReview', 'Approved'] }`. The strings differ only because
 * the frontend uses the spaced domain variants (see AllocationsContext
 * STATUS_MAP): wire `PendingReview` → domain `"Pending Review"`.
 *
 * Kept as an explicit exclusion set — mirroring the cron's deliberate NOT+in
 * shape — so a new AllocationStatus can never silently widen the audience.
 */
const SUBMIT_SETTLED_STATUSES: ReadonlySet<AllocationStatus> = new Set<
  AllocationStatus
>(["Pending Review", "Approved"]);

/**
 * Simulated client-side cron that fires once per user per day on login.
 *
 * Checks the reporting period (previous calendar month) and generates
 * reminder notifications:
 *  - Managers: if any reports are still awaiting the manager's review
 *    (`Pending Review`) — mirrors the cron's `bucketPendingByManager`.
 *  - Employees: if their own record for the period still needs submitting
 *    (no record, `Draft`, or `Needs Revision`).
 *
 * IMPORTANT — desync guard: this effect only runs once the allocations list
 * has actually LOADED (`isLoaded`). Previously it fired on `currentUser` alone;
 * in API mode the allocations query hadn't resolved yet, so `records` was an
 * empty array and an already-Approved allocation looked like "no record →
 * nudge to submit". Gating on `isLoaded` is the fix for the reported bug where
 * an Approved allocation kept generating fresh "Action Required" reminders.
 *
 * The daily stamp (schedulerRuns in NotificationsContext) prevents duplicate
 * notifications when the user navigates between pages or the layout re-mounts.
 */
export function useNotificationScheduler(): void {
  const { currentUser } = useAuth();
  const { records, isLoaded } = useAllocations();
  const { getReports } = useEmployees();
  const { addNotification, hasSchedulerRunToday, recordSchedulerRun } =
    useNotifications();

  // Once-per-login guard, keyed by user id so a re-login as a different user
  // re-evaluates. The schedulerRuns storage check is the persistent daily-dedup.
  const evaluatedForUser = useRef<string | null>(null);

  useEffect(() => {
    // Wait for BOTH a logged-in user AND a settled allocations load. Reading
    // `records` before the fetch resolves is exactly the desync that fired
    // reminders against already-approved allocations.
    if (!currentUser || !isLoaded) return;
    if (evaluatedForUser.current === currentUser.id) return;
    evaluatedForUser.current = currentUser.id;

    // The reporting period (previous calendar month) is the period these
    // reminders are about — sourced from the shared arrears utility so the
    // in-app alert, the SMTP cron, and the UI defaults never diverge.
    const { monthIndex: prevMonthIdx, year, label: prevPeriod } = getReportingPeriod();
    const prevYear = parseInt(year, 10);

    // ── Manager reminder ──────────────────────────────────────────────
    // Mirror the email cron: managers are reminded only about reports still
    // awaiting THEIR review ("Pending Review"). Draft / Needs Revision sit in
    // the employee's court, and Approved is done — none belong in a manager
    // nudge.
    const reports = getReports(currentUser.id);
    if (reports.length > 0) {
      const pendingCount = records.filter(
        (r) =>
          r.managerId === currentUser.id &&
          r.monthIndex === prevMonthIdx &&
          parseInt(r.year, 10) === prevYear &&
          r.status === "Pending Review",
      ).length;

      if (pendingCount > 0) {
        const key = `mgr-${currentUser.id}-${prevYear}-${prevMonthIdx}`;
        if (!hasSchedulerRunToday(key)) {
          addNotification({
            targetUserId: currentUser.id,
            title: "Pending Actions",
            message:
              `You have ${pendingCount} employee work allocation` +
              `${pendingCount === 1 ? "" : "s"} awaiting your review for ${prevPeriod}.`,
            type: "warning",
            actionUrl: "/team-hub",
          });
          recordSchedulerRun(key);
        }
      }
    }

    // ── Employee reminder ─────────────────────────────────────────────
    const myPrevRecord = records.find(
      (r) =>
        r.employeeId === currentUser.id &&
        r.monthIndex === prevMonthIdx &&
        parseInt(r.year, 10) === prevYear,
    );

    // SMTP fan-out for both branches is owned by the backend daily
    // reminder cron (`lib/reminderScheduler.ts`) — it runs every
    // workday and reaches users who never log in. This hook only
    // owns the in-app alert that the user sees when they DO log in.
    //
    // Reminder fires only when the record still needs submitting: no record
    // at all, or a status NOT in the settled set (Pending Review / Approved).
    // This matches the cron's exclusion list exactly.
    const notSubmitted =
      !myPrevRecord || !SUBMIT_SETTLED_STATUSES.has(myPrevRecord.status);
    if (notSubmitted) {
      const key = `emp-${currentUser.id}-${prevYear}-${prevMonthIdx}`;
      if (!hasSchedulerRunToday(key)) {
        addNotification({
          targetUserId: currentUser.id,
          title: "Action Required",
          message: `Please submit your work allocation for ${prevPeriod}.`,
          type: "warning",
          actionUrl: "/allocations",
        });
        recordSchedulerRun(key);
      }
    }

    // Re-runs when the user changes or the allocations load settles. The
    // per-user ref + daily-stamp check together keep it to once per user
    // per calendar day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, isLoaded]);
}
