/**
 * Leave / holiday classification — the single source of truth for what counts
 * as non-working time, shared by the frontend and the API.
 *
 * It lives in the shared package because the SAME rule now gates three
 * surfaces that must never disagree about one employee-month:
 *
 *   - the Daily Journal hour total and monthly aggregator (frontend),
 *   - the Master Overview Excel/PDF export (frontend),
 *   - GET /api/finance-export (API).
 *
 * A frontend-only copy would let the UI export and the CSV report different
 * percentages for the same row — the exact class of divergence the shared
 * `resolveEnhancementTag` was created to kill.
 *
 * Imported by the frontend (zod 3) AND the API (zod 4), so — like
 * enhancementTags.ts — it deliberately holds no zod: just regexes,
 * constants, and pure predicates.
 */
export declare const LEAVE_WORKTYPE_KEYWORDS: readonly {
    re: RegExp;
    workType: string;
}[];
export declare const LEAVE_INTENT_RE: RegExp;
/** True when the text signals a time-off / holiday event of any kind. */
export declare function isLeaveOrHolidayLog(text: string): boolean;
/**
 * Canonical leave Work Type for a description, independent of any taxonomy
 * (e.g. "Sick Leave"). Returns null when no leave keyword matches. This is the
 * taxonomy-agnostic classifier used to BUCKET leaves; the taxonomy-scoped
 * resolution (matching against a scope's real option names) lives in
 * `inferOthersWorkType`.
 */
export declare function detectLeaveWorkType(text: string): string | null;
/**
 * Stable, case-insensitive grouping key for a leave description — the detected
 * Work Type lowercased (e.g. "sick leave"), or null when the text is time-off
 * with no specific type. Two logs share a key iff they are the SAME leave type
 * regardless of casing, so distinct types never consolidate into one card.
 */
export declare function leaveWorkTypeKey(text: string): string | null;
/**
 * Resolve the leave Work Type against a scope's ACTUAL option names
 * (case-insensitive) so the returned value matches a dropdown item verbatim.
 * Keeps scanning past a matched-but-unavailable type so a more generic keyword
 * still in scope (e.g. "Leave") can win. Returns null when nothing matches so
 * the UI falls back to "Select work type..." and the user classifies manually.
 *
 * @param description    the parsed card description text
 * @param scopeWorkTypes the Work Type names valid under the OTHERS sub category
 */
export declare function inferOthersWorkType(description: string, scopeWorkTypes: readonly string[]): string | null;
/**
 * Canonical taxonomy coordinates for non-working time. Matching is always
 * case-insensitive — the live taxonomy stores "OTHERS" uppercase while the
 * seed/parser produce "Others", and Work Types arrive in mixed casing.
 */
export declare const NON_WORKING_CATEGORY = "General Work";
export declare const NON_WORKING_SUBCATEGORY = "OTHERS";
/** Work Types that represent non-working time and must never be costed. */
export declare const NON_WORKING_WORK_TYPES: readonly string[];
/**
 * True when a *classified* allocation activity is non-working time.
 *
 * Keyed on Work Type, NOT sub category: "OTHERS" is a catch-all that also
 * holds real work, so excluding the whole sub category would drop legitimate
 * allocated hours. The category/sub category are accepted for call-site
 * clarity but are deliberately not part of the test.
 */
export declare function isNonWorkingActivity(activity: {
    workCategory?: string | null;
    subCategory?: string | null;
    workType?: string | null;
}): boolean;
/**
 * True when a *raw, unclassified* journal line is non-working time.
 *
 * Used by the daily-log hour total and the monthly aggregator, which run
 * BEFORE any taxonomy is attached. Delegates to the existing keyword net so
 * the pre-classification and post-classification rules can never diverge.
 */
export declare function isNonWorkingLogText(text: string): boolean;
//# sourceMappingURL=leaveClassification.d.ts.map