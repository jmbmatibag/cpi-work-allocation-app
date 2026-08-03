/**
 * Guardrails for extracting the allocation percentage out of a hierarchical
 * journal block (`@Client #Tag:` header followed by `-- bullet` lines).
 *
 * -- Root cause this module defends against ---------------------------------
 * A bullet that is a *bare number with no `%` sign* -- e.g. a Service-Request
 * ticket typed as `-- 41631` instead of the standard `-- SR 41631` -- was being
 * read as a 41631% allocation. Two compounding defects caused it:
 *
 *   1. The legacy `TRAILING_PCT` regex made the `%` sign OPTIONAL (`%?`), so a
 *      line ending in a bare number counted as a percentage.
 *   2. Every hierarchical bullet starts with `--`, which supplied the leading
 *      delimiter the regex keyed on -- so `-- 41631` looked identical to
 *      `- 41631%`.
 *
 * With the block loop summing every "percentage" bullet, `-- 41631` + the real
 * `- 6.53%` produced 41637.53%, blowing up the Allocation Progress ring.
 *
 * The fixes here:
 *   - The `%` sign is now REQUIRED. A bare number can never be a percentage.
 *   - A hard ceiling (`MAX_BLOCK_PERCENT`) backstops the summed total, so even
 *     if a future regex hole reappears, an anomaly like 41637 can never reach
 *     the UI.
 *   - Copy/paste artifacts (NBSP, zero-width chars, fullwidth percent) are
 *     normalised before matching.
 */

/**
 * Hard ceiling for a single allocation block. One block is one card's share of
 * a person's month, so it can never legitimately exceed 100%. Anything above
 * this is a parse artifact and is clamped rather than propagated to the ring.
 */
export const MAX_BLOCK_PERCENT = 100;

/**
 * A trailing percentage token on a bullet line:
 *   - a leading delimiter (dash / en-dash / em-dash / colon),
 *   - an integer, decimal, or leading-dot decimal,
 *   - a REQUIRED literal `%`,
 *   - anchored to end-of-line.
 *
 *   "- 6.53%"           -> 6.53
 *   "AWS migration 20%" -> no match (no delimiter before the number)
 *   "41631"             -> no match (no `%`)
 *   "SR 41631"          -> no match (no `%`)
 */
const LINE_PCT = /[-–—:]\s*(\d+(?:\.\d+)?|\.\d+)\s*%\s*$/;

/** Neutralise copy/paste artifacts that break naive numeric parsing. */
function sanitize(input: string): string {
  return (input ?? "")
    .replace(/ /g, " ") // NBSP -> normal space
    .replace(/[​-‍﻿]/g, "") // zero-width chars
    .replace(/％/g, "%"); // fullwidth percent -> %
}

/**
 * Extract the trailing percentage from a single bullet line.
 * Returns the numeric value (e.g. `6.53`) or `null` when the line carries no
 * `%`-terminated percentage. Standalone numbers and IDs return `null`.
 */
export function extractLinePercent(line: string): number | null {
  const m = sanitize(line).match(LINE_PCT);
  if (!m) return null;
  const value = parseFloat(m[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Bound a summed block percentage to a sane range. Returns `0` for
 * non-finite/negative input and caps at `MAX_BLOCK_PERCENT`, absorbing float
 * dust just above the ceiling (e.g. `100.0000001` -> `100`). This is the last
 * line of defence guaranteeing the UI can never receive an anomalous value.
 */
export function clampBlockPercentage(total: number): number {
  if (!Number.isFinite(total) || total < 0) return 0;
  const EPSILON = 1e-6;
  if (total > MAX_BLOCK_PERCENT + EPSILON) return MAX_BLOCK_PERCENT;
  return Math.min(total, MAX_BLOCK_PERCENT);
}

/**
 * Sum the `%`-bearing bullets of a block and bound the result. Bullets without
 * a literal `%` (bare numbers, SR IDs, plain descriptions) contribute nothing.
 */
export function sumBlockPercentages(lines: readonly string[]): number {
  let total = 0;
  for (const line of lines) {
    const p = extractLinePercent(line);
    if (p !== null) total += p;
  }
  return clampBlockPercentage(total);
}
