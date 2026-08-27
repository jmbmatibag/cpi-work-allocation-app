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
// ── Resolution ──────────────────────────────────────────────────────────────
// Lives HERE, not in the API, because there are two export pipelines that both
// have to agree: the API's flat Finance CSV (/api/finance-export) and the
// frontend's Excel/PDF export (lib/exports). A second copy of this logic is
// exactly how the two would drift into reporting different values for the
// same row.
/**
 * Build a tolerant matcher for one canonical tag.
 *
 * The tolerances absorb the noise this feature exists to eliminate, and the
 * value RETURNED is always the canonical roster spelling, never the logger's
 * variant:
 *
 *   • separators  → `[\s/-]+`     "axa smart claims" ~ "AXA-SMART CLAIMS"
 *   • letter→digit→ optional gap  "GISTP 2.5" ~ "GISTP2.5"
 *   • word edges  → lookaround    "AXA-MTCX" is NOT a hit
 */
function buildTagPattern(tag) {
    const body = tag
        // Escape regex specials first, so "GISTP2.5" becomes "GISTP2\.5".
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // Any run of space / hyphen / slash in the tag matches any such run in the
        // text. The roster uses a CLIENT-FEATURE convention, and in free text
        // people type that separator as a space, a hyphen, or both.
        .replace(/[\s/-]+/g, '[\\s/-]+')
        .replace(/([A-Za-z])(\d)/g, '$1[\\s-]*$2');
    return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'i');
}
/**
 * Compiled matchers for one roster, longest-tag-first so a longer tag always
 * beats a shorter one it contains. Memoised on roster contents: an export
 * touches thousands of rows but only ever one roster.
 */
const matcherCache = new Map();
export function buildEnhancementMatchers(roster) {
    const key = JSON.stringify(roster);
    const hit = matcherCache.get(key);
    if (hit)
        return hit;
    const built = [...roster]
        .filter((t) => t.trim().length > 0)
        .sort((a, b) => b.length - a.length)
        .map((tag) => [tag, buildTagPattern(tag)]);
    matcherCache.set(key, built);
    return built;
}
/**
 * Historical fallback — recover the enhancement name from free text.
 *
 * Rows logged before `enhancementTag` existed carry the name only inside the
 * description. Returns null when nothing matches: this column gates Finance's
 * own review, so a guessed tag would pass that review unchecked while a blank
 * is visibly incomplete.
 *
 * `roster` is required, not defaulted. Defaulting it to the constants above is
 * exactly how the inference-rule bug hid for weeks — the parser looked healthy
 * while silently ignoring everything the admin had configured.
 */
export function extractEnhancementTag(description, roster) {
    const text = (description ?? '').trim();
    if (!text)
        return null;
    for (const [tag, re] of buildEnhancementMatchers(roster)) {
        if (re.test(text))
            return tag;
    }
    return null;
}
/**
 * Hybrid resolution, most-trusted source first:
 *
 *   1. The stored tag — a human picked it from the roster. Authoritative, and
 *      returned even if an admin has since removed it: the historical record
 *      of what was logged outranks today's list.
 *   2. Description parse — ONLY for Specific Enhancement rows, so an unrelated
 *      task that merely mentions a tag in passing is never mislabelled.
 *   3. Blank.
 */
export function resolveEnhancementTag(row, roster) {
    const stored = row.enhancementTag?.trim();
    if (stored)
        return stored;
    if (!isSpecificEnhancement(row.workType))
        return '';
    return extractEnhancementTag(row.description, roster) ?? '';
}
//# sourceMappingURL=enhancementTags.js.map