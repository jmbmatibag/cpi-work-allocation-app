import { describe, it, expect } from "vitest";
import {
  extractLinePercent,
  clampBlockPercentage,
  sumBlockPercentages,
  MAX_BLOCK_PERCENT,
} from "../blockPercentage";

describe("extractLinePercent", () => {
  it("extracts a trailing decimal percentage", () => {
    expect(extractLinePercent("-- Other query by sir Carl - 6.53%")).toBe(6.53);
  });

  it("extracts an integer percentage", () => {
    expect(extractLinePercent("-- AWS migration - 20%")).toBe(20);
  });

  it("supports a leading-dot decimal", () => {
    expect(extractLinePercent("-- tweak - .5%")).toBe(0.5);
  });

  it("accepts colon, en-dash and em-dash delimiters", () => {
    expect(extractLinePercent("-- task : 4.55%")).toBe(4.55);
    expect(extractLinePercent("-- task – 3.41%")).toBe(3.41);
    expect(extractLinePercent("-- task — 1.70%")).toBe(1.7);
  });

  // The core regression: a bare number with NO `%` must never be a percentage.
  it("returns null for a bare number bullet (the 41631 bug)", () => {
    expect(extractLinePercent("-- 41631")).toBeNull();
  });

  it("returns null for an SR ticket number", () => {
    expect(extractLinePercent("-- SR 41631")).toBeNull();
    expect(extractLinePercent("-- SR 39139")).toBeNull();
  });

  it("returns null for plain description bullets", () => {
    expect(extractLinePercent("-- SA Deployment and testing")).toBeNull();
    expect(extractLinePercent("-- support for")).toBeNull();
  });

  it("normalises NBSP and fullwidth percent signs", () => {
    // NBSP ( ) around the delimiter, fullwidth percent (％) sign.
    expect(extractLinePercent("-- task - 6.53％")).toBe(6.53);
  });
});

describe("clampBlockPercentage", () => {
  it("passes valid values through unchanged", () => {
    expect(clampBlockPercentage(6.53)).toBe(6.53);
    expect(clampBlockPercentage(0)).toBe(0);
    expect(clampBlockPercentage(100)).toBe(100);
  });

  it("caps anomalies at the ceiling", () => {
    expect(clampBlockPercentage(41637.53)).toBe(MAX_BLOCK_PERCENT);
    expect(clampBlockPercentage(101)).toBe(MAX_BLOCK_PERCENT);
  });

  it("absorbs float dust just above the ceiling", () => {
    expect(clampBlockPercentage(100.0000001)).toBe(MAX_BLOCK_PERCENT);
  });

  it("returns 0 for non-finite or negative input", () => {
    expect(clampBlockPercentage(NaN)).toBe(0);
    expect(clampBlockPercentage(Infinity)).toBe(0);
    expect(clampBlockPercentage(-5)).toBe(0);
  });
});

describe("sumBlockPercentages", () => {
  it("sums multiple %-bearing bullets (fan-out format)", () => {
    expect(
      sumBlockPercentages(["-- AWS migration - 20%", "-- Security audit - 15%"]),
    ).toBe(35);
  });

  it("ignores bare numbers and IDs while summing", () => {
    expect(
      sumBlockPercentages([
        "-- support for",
        "-- 41631", // bare number — must contribute 0
        "-- SR 41631", // SR ticket — must contribute 0
        "-- Other query by sir Carl - 6.53%",
      ]),
    ).toBe(6.53);
  });

  it("reproduces the exact failing ABIC block -> 6.53, not 41637.53", () => {
    const abic = [
      "-- support for",
      "-- 41631",
      "-- SA Deployment and testing",
      "-- SR 41631",
      "-- Test Annualized Amounts",
      "-- SR 39715",
      "-- Other QA queries and testings",
      "-- Bulletin and recreation",
      "-- Bulletin",
      "-- support",
      "-- Other query by sir Carl - 6.53%",
    ];
    expect(sumBlockPercentages(abic)).toBe(6.53);
  });

  it("returns 0 for a block with no percentages", () => {
    expect(sumBlockPercentages(["-- scoping", "-- interviews"])).toBe(0);
  });

  it("bounds a pathological block so the UI can never break", () => {
    // Even if two bullets literally carry huge %, the result is capped.
    expect(sumBlockPercentages(["-- a - 41631%", "-- b - 6.53%"])).toBe(
      MAX_BLOCK_PERCENT,
    );
  });
});
