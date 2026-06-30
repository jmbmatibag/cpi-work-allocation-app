/**
 * Reporting-period date utility — the single source of truth for the
 * "approval lifecycle operates in arrears" business rule.
 *
 * The lifecycle runs exactly one calendar month behind the wall clock: the
 * period being submitted, reminded about, reviewed, and reported on is
 * always the PREVIOUS calendar month. If today is any day in June 2026, the
 * active Reporting/Approval Period is "May 2026".
 *
 * Every notification, reminder, and reporting-view default MUST derive its
 * period from this function instead of an inline `new Date()`, so the rule
 * can never drift between the cron, the controllers, and the UI. Pass an
 * explicit `currentDate` (e.g. in tests) to pin the clock.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export interface ReportingPeriod {
  /** Full month name, e.g. "May" — matches AllocationRecord.month. */
  month: string;
  /** Four-digit year as a string, e.g. "2026" — matches AllocationRecord.year. */
  year: string;
  /** 0-based month index, e.g. 4 for May — matches AllocationRecord.monthIndex. */
  monthIndex: number;
  /** Canonical "{Month} {Year}" Period string, e.g. "May 2026". */
  label: string;
}

/**
 * Resolve the active reporting period (the previous calendar month) for a
 * given reference date. Defaults to "now".
 *
 * The subtraction is done on the month *index* and year only — never on the
 * day-of-month — which sidesteps the classic `Date.setMonth()` overflow bug
 * (e.g. Jan 31 → Mar 3). January (index 0) wraps to December (index 11) of
 * the prior year.
 */
export function getReportingPeriod(currentDate: Date = new Date()): ReportingPeriod {
  const isJanuary = currentDate.getMonth() === 0;
  const monthIndex = isJanuary ? 11 : currentDate.getMonth() - 1;
  const year = isJanuary ? currentDate.getFullYear() - 1 : currentDate.getFullYear();
  const month = MONTH_NAMES[monthIndex];
  return {
    month,
    year: String(year),
    monthIndex,
    label: `${month} ${year}`,
  };
}
