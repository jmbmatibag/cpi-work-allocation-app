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
// Keyword → canonical Work Type, ordered specific-first so multi-word forms
// ("sick leave") win over the bare "leave" fallback. Every pattern is
// case-insensitive; word boundaries keep them robust against surrounding text.
export const LEAVE_WORKTYPE_KEYWORDS = [
    { re: /\bsick\b/i, workType: "Sick Leave" },
    { re: /\b(?:vacation|annual)\b/i, workType: "Vacation Leave" },
    { re: /\bmaternity\b/i, workType: "Maternity Leave" },
    { re: /\bpaternity\b/i, workType: "Paternity Leave" },
    { re: /\bsabbatical\b/i, workType: "Sabbatical Leave" },
    { re: /\bemergency\b/i, workType: "Emergency Leave" },
    { re: /\bbereavement\b/i, workType: "Bereavement Leave" },
    { re: /\bholiday\b/i, workType: "Holiday" },
    { re: /\bleave\b/i, workType: "Leave" }, // generic — checked last
];
// Broader net of time-off signals used ONLY to decide the OTHERS reroute — a
// log can be time-off without naming a specific leave type (e.g. "day off").
// Deliberately conservative: ambiguous words like "annual" / "emergency" are
// omitted (they'd false-trigger on "annual report" / "emergency hotfix") since
// their leave forms already contain the "leave" token caught here.
export const LEAVE_INTENT_RE = /\b(?:leave|holiday|vacation|sick|maternity|paternity|sabbatical|bereavement|pto|day\s*off|time\s*off)\b/i;
/** True when the text signals a time-off / holiday event of any kind. */
export function isLeaveOrHolidayLog(text) {
    return LEAVE_INTENT_RE.test(text);
}
/**
 * Canonical leave Work Type for a description, independent of any taxonomy
 * (e.g. "Sick Leave"). Returns null when no leave keyword matches. This is the
 * taxonomy-agnostic classifier used to BUCKET leaves; the taxonomy-scoped
 * resolution (matching against a scope's real option names) lives in
 * `inferOthersWorkType`.
 */
export function detectLeaveWorkType(text) {
    for (const { re, workType } of LEAVE_WORKTYPE_KEYWORDS) {
        if (re.test(text))
            return workType;
    }
    return null;
}
/**
 * Stable, case-insensitive grouping key for a leave description — the detected
 * Work Type lowercased (e.g. "sick leave"), or null when the text is time-off
 * with no specific type. Two logs share a key iff they are the SAME leave type
 * regardless of casing, so distinct types never consolidate into one card.
 */
export function leaveWorkTypeKey(text) {
    return detectLeaveWorkType(text)?.toLowerCase() ?? null;
}
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
export function inferOthersWorkType(description, scopeWorkTypes) {
    const byLower = new Map(scopeWorkTypes.map((w) => [w.toLowerCase(), w]));
    for (const { re, workType } of LEAVE_WORKTYPE_KEYWORDS) {
        if (!re.test(description))
            continue;
        const canonical = byLower.get(workType.toLowerCase());
        if (canonical)
            return canonical; // exact scoped option, real casing
        // Keyword matched but this scope doesn't define that specific type — keep
        // scanning so a more generic keyword still in scope (e.g. "Leave") wins.
    }
    return null;
}
// ---------------------------------------------------------------------
// Non-working-time exclusion
// ---------------------------------------------------------------------
/**
 * Canonical taxonomy coordinates for non-working time. Matching is always
 * case-insensitive — the live taxonomy stores "OTHERS" uppercase while the
 * seed/parser produce "Others", and Work Types arrive in mixed casing.
 */
export const NON_WORKING_CATEGORY = "General Work";
export const NON_WORKING_SUBCATEGORY = "OTHERS";
/** Work Types that represent non-working time and must never be costed. */
export const NON_WORKING_WORK_TYPES = [
    "Holiday",
    "Leave",
    "Sick Leave",
    "Vacation Leave",
    "Maternity Leave",
    "Paternity Leave",
    "Sabbatical Leave",
    "Emergency Leave", // present in LEAVE_WORKTYPE_KEYWORDS above
    "Bereavement Leave", // present in LEAVE_WORKTYPE_KEYWORDS above
];
const NON_WORKING_WORK_TYPE_SET = new Set(NON_WORKING_WORK_TYPES.map((w) => w.toLowerCase()));
/**
 * True when a *classified* allocation activity is non-working time.
 *
 * Keyed on Work Type, NOT sub category: "OTHERS" is a catch-all that also
 * holds real work, so excluding the whole sub category would drop legitimate
 * allocated hours. The category/sub category are accepted for call-site
 * clarity but are deliberately not part of the test.
 */
export function isNonWorkingActivity(activity) {
    const wt = activity.workType?.trim().toLowerCase() ?? "";
    if (!wt)
        return false;
    return NON_WORKING_WORK_TYPE_SET.has(wt);
}
/**
 * True when a *raw, unclassified* journal line is non-working time.
 *
 * Used by the daily-log hour total and the monthly aggregator, which run
 * BEFORE any taxonomy is attached. Delegates to the existing keyword net so
 * the pre-classification and post-classification rules can never diverge.
 */
export function isNonWorkingLogText(text) {
    return isLeaveOrHolidayLog(text);
}
//# sourceMappingURL=leaveClassification.js.map