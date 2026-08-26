/**
 * Enhancement tagging — shared vocabulary for "Specific Enhancement" work.
 *
 * Finance's Enhancement column used to be recovered by eyeballing free-text
 * descriptions, so a typo ("Smart Claim", "MTC-API") silently dropped a row
 * out of its bucket. The fix is a fixed, structured tag picked from a
 * maintained roster at log time; the description parse survives only as a
 * fallback for rows logged before the column existed.
 *
 * This module is imported by the frontend (zod 3) AND the API (zod 4), so it
 * deliberately holds no zod — just constants and predicates.
 */
/**
 * SEED / LAST-RESORT FALLBACK ONLY. The live roster is the `Enhancement`
 * table, surfaced through GET /api/settings and maintained in Admin Settings.
 *
 * Named DEFAULT_* on purpose. The inference-rules bug taught this the hard
 * way: a parser that silently fell back to its DEFAULT_ constants looked like
 * it was working while ignoring every rule the admin had configured. If you
 * are reading this list at a call site that could have been handed the live
 * roster instead, that call site is wrong.
 */
export const DEFAULT_ENHANCEMENT_TAGS = [
    'MTC API',
    'Smart Claims',
    'OAuth/OIDC',
    'Plate Number Validation',
    'Treaty Limit',
    'GISTP2.5',
];
/**
 * Case-insensitive, whitespace-resistant "Specific Enhancement" matcher.
 *
 * Consolidated from the two private copies that already existed in the
 * frontend (promptParser.ts and journalAggregation.ts) — the API needed a
 * third for the export fallback, and three copies of a business rule drift.
 * `\s*` between the words tolerates the glued "SpecificEnhancement", the
 * canonical "Specific Enhancement", and any extra-spaced variant alike.
 */
export const SPECIFIC_ENHANCEMENT_RE = /specific\s*enhancement/i;
/** True when this work type is the Specific Enhancement type, in any casing. */
export function isSpecificEnhancement(workType) {
    return SPECIFIC_ENHANCEMENT_RE.test(workType ?? '');
}
/**
 * True when `value` is on the supplied roster.
 *
 * Takes the roster explicitly rather than closing over the defaults so a
 * caller physically cannot check against a stale list — pass what the
 * settings snapshot gave you.
 *
 * Comparison is case-insensitive and whitespace-normalised: a tag stored
 * before an admin adjusted its casing is still "known", and rendering it as
 * "(custom)" would be misleading.
 */
export function isKnownEnhancementTag(value, roster) {
    if (!value)
        return false;
    const key = normalizeEnhancementTag(value);
    return roster.some((t) => normalizeEnhancementTag(t) === key);
}
/** Comparison key for a tag: trimmed, whitespace-collapsed, lower-cased. */
export function normalizeEnhancementTag(value) {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
//# sourceMappingURL=enhancementTags.js.map