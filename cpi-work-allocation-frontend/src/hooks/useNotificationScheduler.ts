import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAllocations, MONTH_NAMES } from "@/contexts/AllocationsContext";
import { useEmployees } from "@/contexts/EmployeesContext";
import { useNotifications } from "@/contexts/NotificationsContext";

/**
 * Simulated client-side cron that fires once per user per day on mount.
 *
 * Checks the previous calendar month and generates reminder notifications:
 *  - Managers: if any reports have non-Approved allocations outstanding.
 *  - Employees: if their own previous-month allocation hasn't been submitted.
 *
 * The daily stamp (schedulerRuns in NotificationsContext) prevents
 * duplicate notifications when the user navigates between pages or the
 * layout re-mounts.
 */
export function useNotificationScheduler(): void {
  const { currentUser } = useAuth();
  const { records } = useAllocations();
  const { employees, getReports } = useEmployees();
  const { addNotification, hasSchedulerRunToday, recordSchedulerRun } =
    useNotifications();

  // Ref guard prevents double-fire in React StrictMode (dev only).
  // The schedulerRuns storage check is the persistent daily-dedup.
  const hasRun = useRef(false);

  useEffect(() => {
    if (!currentUser || hasRun.current) return;
    hasRun.current = true;

    const today = new Date();
    const prevMonthIdx =
      today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    const prevYear =
      today.getMonth() === 0
        ? today.getFullYear() - 1
        : today.getFullYear();
    const prevPeriod = `${MONTH_NAMES[prevMonthIdx]} ${prevYear}`;

    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    // ── Manager reminder ──────────────────────────────────────────────
    const reports = getReports(currentUser.id);
    if (reports.length > 0) {
      const pendingCount = records.filter(
        (r) =>
          r.managerId === currentUser.id &&
          r.monthIndex === prevMonthIdx &&
          parseInt(r.year, 10) === prevYear &&
          r.status !== "Approved",
      ).length;

      if (pendingCount > 0) {
        const key = `mgr-${currentUser.id}-${prevYear}-${prevMonthIdx}`;
        if (!hasSchedulerRunToday(key)) {
          addNotification({
            targetUserId: currentUser.id,
            title: "Pending Actions",
            message:
              `You have ${pendingCount} unapproved/unsubmitted employee work ` +
              `allocation${pendingCount === 1 ? "" : "s"} for ${prevPeriod}.`,
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
    const notSubmitted =
      !myPrevRecord ||
      myPrevRecord.status === "Draft" ||
      myPrevRecord.status === "NeedsRevision";
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

    // Intentionally omitting all deps except currentUser?.id.
    // This effect must run once per login session — the daily-stamp
    // check (hasSchedulerRunToday) handles calendar-day dedup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);
}
