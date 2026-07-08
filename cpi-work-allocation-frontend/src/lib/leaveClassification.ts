/**
 * Leave / holiday classification shared by the parse-time intercept
 * (Workspace.applyLeaveOverride) and the journal aggregator
 * (journalAggregation.resolveBucket).
 *
 * Keeping the keyword map in ONE place guarantees both stages agree on what
 * counts as time-off and which Work Type a description maps to — so leaves
 * bucket the same way they later classify. In particular the aggregator uses
 * `leaveWorkTypeKey` to keep DISTINCT leave types in separate cards while
 * merging case variants ("sick leave" / "Sick Leave" / "SICK LEAVE") into one.
 */

// Keyword → canonical Work Type, ordered specific-first so multi-word forms
// ("sick leave") win over the bare "leave" fallback. Every pattern is
// case-insensitive; word boundaries keep them robust against surrounding text.
export const LEAVE_WORKTYPE_KEYWORDS: readonly { re: RegExp; workType: string }[] = [
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
export const LEAVE_INTENT_RE =
  /\b(?:leave|holiday|vacation|sick|maternity|paternity|sabbatical|bereavement|pto|day\s*off|time\s*off)\b/i;

/** True when the text signals a time-off / holiday event of any kind. */
export function isLeaveOrHolidayLog(text: string): boolean {
  return LEAVE_INTENT_RE.test(text);
}

/**
 * Canonical leave Work Type for a description, independent of any taxonomy
 * (e.g. "Sick Leave"). Returns null when no leave keyword matches. This is the
 * taxonomy-agnostic classifier used to BUCKET leaves; the taxonomy-scoped
 * resolution (matching against a scope's real option names) lives in
 * `inferOthersWorkType`.
 */
export function detectLeaveWorkType(text: string): string | null {
  for (const { re, workType } of LEAVE_WORKTYPE_KEYWORDS) {
    if (re.test(text)) return workType;
  }
  return null;
}

/**
 * Stable, case-insensitive grouping key for a leave description — the detected
 * Work Type lowercased (e.g. "sick leave"), or null when the text is time-off
 * with no specific type. Two logs share a key iff they are the SAME leave type
 * regardless of casing, so distinct types never consolidate into one card.
 */
export function leaveWorkTypeKey(text: string): string | null {
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
export function inferOthersWorkType(
  description: string,
  scopeWorkTypes: readonly string[],
): string | null {
  const byLower = new Map(scopeWorkTypes.map((w) => [w.toLowerCase(), w]));
  for (const { re, workType } of LEAVE_WORKTYPE_KEYWORDS) {
    if (!re.test(description)) continue;
    const canonical = byLower.get(workType.toLowerCase());
    if (canonical) return canonical; // exact scoped option, real casing
    // Keyword matched but this scope doesn't define that specific type — keep
    // scanning so a more generic keyword still in scope (e.g. "Leave") wins.
  }
  return null;
}
