import { describe, expect, it } from "vitest";
import {
  distributePercentages,
  sumPercentages,
  totalsTo,
} from "../allocationMath";

describe("distributePercentages", () => {
  it("returns [] for empty input", () => {
    expect(distributePercentages([])).toEqual([]);
  });

  it("single bucket gets 100", () => {
    expect(distributePercentages([1])).toEqual([100]);
    expect(distributePercentages([42])).toEqual([100]);
  });

  it("clean halves", () => {
    expect(distributePercentages([1, 1])).toEqual([50, 50]);
  });

  it("3-way split distributes the 0.01 leftover deterministically", () => {
    // 100 / 3 = 33.33..., three floors of 33.33 = 99.99, one leftover unit.
    const result = distributePercentages([1, 1, 1]);
    expect(totalsTo(result)).toBe(true);
    expect(result).toEqual([33.34, 33.33, 33.33]);
  });

  it("7-way split (the classic float-trap case) sums to exactly 100", () => {
    // 100 / 7 = 14.2857..., the case the old algorithm got wrong.
    const result = distributePercentages([1, 1, 1, 1, 1, 1, 1]);
    expect(totalsTo(result)).toBe(true);
    expect(result).toHaveLength(7);
  });

  it("preserves existing integer proportions exactly", () => {
    expect(distributePercentages([50, 30, 20])).toEqual([50, 30, 20]);
  });

  it("handles huge imbalance without negative or >100 values", () => {
    const result = distributePercentages([1_000_000, 1, 1, 1]);
    expect(totalsTo(result)).toBe(true);
    expect(result[0]).toBe(100);
    expect(result.slice(1).every((v) => v === 0)).toBe(true);
  });

  it("holds the guarantee for every N from 1 to 100 with equal weights", () => {
    for (let n = 1; n <= 100; n++) {
      const weights = Array(n).fill(1);
      const result = distributePercentages(weights);
      expect(result).toHaveLength(n);
      expect(totalsTo(result)).toBe(true);
      expect(result.every((v) => v >= 0 && v <= 100)).toBe(true);
    }
  });

  it("holds the guarantee for randomized weight vectors", () => {
    const rng = mulberry32(0xC0FFEE); // deterministic seed
    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + Math.floor(rng() * 20);
      const weights = Array.from({ length: n }, () => Math.floor(rng() * 100) + 1);
      const result = distributePercentages(weights);
      expect(totalsTo(result)).toBe(true);
    }
  });

  it("throws on negative weights", () => {
    expect(() => distributePercentages([1, -1, 1])).toThrow();
  });

  it("throws on all-zero weights", () => {
    expect(() => distributePercentages([0, 0, 0])).toThrow();
  });
});

describe("sumPercentages", () => {
  it("sums with 2dp rounding (guards against IEEE-754 noise)", () => {
    expect(sumPercentages([14.29, 14.29, 14.29, 14.29, 14.29, 14.29, 14.26])).toBe(100);
  });
});

describe("totalsTo", () => {
  it("accepts a custom target", () => {
    expect(totalsTo([50, 50], 100)).toBe(true);
    expect(totalsTo([25, 25], 50)).toBe(true);
  });
});

// ---- helpers -----------------------------------------------------------

// Mulberry32 — small, deterministic PRNG for reproducible fuzz runs.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
