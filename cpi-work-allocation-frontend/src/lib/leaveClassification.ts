/**
 * Leave / holiday classification — re-export shim.
 *
 * The implementation moved to `cpi-work-allocation-shared/lib/leaveClassification`
 * when the Finance export (API-side) had to enforce the identical rule: a
 * frontend-only copy would let the Master Overview Excel/PDF and the
 * `/api/finance-export` CSV report different percentages for the same
 * employee-month.
 *
 * This file stays because every frontend call site already imports from
 * `@/lib/leaveClassification` — same pattern the API uses in
 * `lib/financeExport.ts` for the enhancement-tag resolvers. Import from here
 * in frontend code; edit the rule in the shared package.
 */

export {
  LEAVE_WORKTYPE_KEYWORDS,
  LEAVE_INTENT_RE,
  isLeaveOrHolidayLog,
  detectLeaveWorkType,
  leaveWorkTypeKey,
  inferOthersWorkType,
  NON_WORKING_CATEGORY,
  NON_WORKING_SUBCATEGORY,
  NON_WORKING_WORK_TYPES,
  isNonWorkingActivity,
  isNonWorkingLogText,
} from "cpi-work-allocation-shared";
