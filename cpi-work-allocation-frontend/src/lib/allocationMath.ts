/**
 * Allocation math utilities.
 *
 * The 5-pillar work allocation schema requires the total percentage
 * across a monthly allocation to equal exactly 100.00%. Floating-point
 * percentage math does NOT guarantee that — rounding each bucket
 * independently to 2dp produces totals like 99.99 or 100.03 for many
 * N-way splits (7-way is the classic offender: 100/7 ≈ 14.2857...).
 *
 * These helpers work in *integer hundredths* (1/10000 of a whole) and
 * use the largest-remainder (Hamilton) method to distribute the
 * leftover units fairly across the buckets with the strongest
 * fractional claims. The result is mathematically guaranteed to sum
 * to exactly 100.00 for any non-empty, non-zero weight vector.
 *
 * All functions here are pure — no React, no side effects — so they
 * are trivially unit-testable. See __tests__/allocationMath.test.ts.
 */

const TOTAL_UNITS = 10_000; // hundredths of a percent: 100.00% = 10,000 units

/**
 * Distribute 100.00% across N weighted buckets.
 *
 * @param weights  Non-negative numbers (e.g., day counts per bucket).
 *                 Must sum to > 0 if the array is non-empty.
 * @returns        Array of 2dp percentages, same length as `weights`,
 *                 whose rounded sum is exactly 100.00. Returns [] for
 *                 an empty input.
 *
 * @example
 *   distributePercentages([1, 1, 1])          // [33.34, 33.33, 33.33]
 *   distributePercentages([1, 1, 1, 1, 1, 1, 1])
 *                                              // [14.29, 14.29, ..., 14.29, 14.26]
 */
export function distributePercentages(weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0)) {
    throw new Error("distributePercentages: weights must be non-negative");
  }

  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) {
    throw new Error("distributePercentages: total weight must be > 0");
  }

  // Exact share in hundredths, then split into integer floor + fractional remainder.
  const exact = weights.map((w) => (w * TOTAL_UNITS) / total);
  const floors = exact.map(Math.floor);
  const remainders = exact.map((e, i) => ({ i, frac: e - floors[i] }));

  // How many hundredths are unassigned after flooring. Always >= 0 and
  // < weights.length, so this loop is bounded.
  const assigned = floors.reduce((a, b) => a + b, 0);
  const leftover = TOTAL_UNITS - assigned;

  // Hand out leftover units to the largest fractional claims.
  // Ties broken by original index for deterministic output.
  remainders.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < leftover; k++) {
    floors[remainders[k].i] += 1;
  }

  return floors.map((h) => h / 100);
}

/**
 * Sum an array of 2dp percentages and round defensively back to 2dp.
 * Use wherever a running total must be compared against 100 — strict
 * equality on raw float sums is unsafe.
 */
export function sumPercentages(values: readonly number[]): number {
  const raw = values.reduce((a, v) => a + v, 0);
  return Math.round(raw * 100) / 100;
}

/**
 * Strict equality check for a percentage total vs. a target, tolerant
 * of IEEE-754 noise. Defaults to target = 100.
 */
export function totalsTo(
  values: readonly number[],
  target = 100,
): boolean {
  return sumPercentages(values) === target;
}
