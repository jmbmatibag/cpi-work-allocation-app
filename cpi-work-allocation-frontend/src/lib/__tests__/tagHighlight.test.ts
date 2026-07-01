import { describe, it, expect } from "vitest";
import { buildHighlightRegex, multiWordTagPattern } from "../tagHighlight";

/**
 * Collect the tag tokens a highlight regex would mark. Mirrors what
 * renderTagged() colours, so these assertions describe the visible spans.
 */
function matchedTags(text: string, names: readonly string[]): string[] {
  const re = buildHighlightRegex(names);
  return [...text.matchAll(re)].map((m) => m[1]);
}

const NAMES = ["Sales, Marketing & BD", "Quick Policy", "General Work"];

describe("buildHighlightRegex — multi-word tags with punctuation", () => {
  it("highlights the full punctuated name (canonical form)", () => {
    expect(matchedTags("- #Sales, Marketing & BD proposal - 100%", NAMES)).toEqual([
      "#Sales, Marketing & BD",
    ]);
  });

  it("tolerates a space before the comma (as typed in the UI)", () => {
    expect(matchedTags("- #Sales , Marketing & BD proposal", NAMES)).toEqual([
      "#Sales , Marketing & BD",
    ]);
  });

  it("tolerates a missing space after the comma", () => {
    expect(matchedTags("#Sales,Marketing & BD", NAMES)).toEqual([
      "#Sales,Marketing & BD",
    ]);
  });

  it("tolerates extra whitespace padding around separators", () => {
    expect(matchedTags("work #Sales ,  Marketing  &  BD done", NAMES)).toEqual([
      "#Sales ,  Marketing  &  BD",
    ]);
  });

  it("still highlights plain multi-word names (#Quick Policy)", () => {
    expect(matchedTags("- Enhancement #Quick Policy - 30%", NAMES)).toEqual([
      "#Quick Policy",
    ]);
  });

  it("highlights @client tags alongside #category tags", () => {
    expect(matchedTags("@AUII #Sales, Marketing & BD", NAMES)).toEqual([
      "@AUII",
      "#Sales, Marketing & BD",
    ]);
  });

  it("degrades to single-word extraction for unknown text", () => {
    // "#Sales" alone is not a known multi-word name here → single token only.
    expect(matchedTags("#Sales pitch", NAMES)).toEqual(["#Sales"]);
  });
});

describe("multiWordTagPattern", () => {
  it("returns null for names with no alphanumeric content", () => {
    expect(multiWordTagPattern(" , & ")).toBeNull();
  });

  it("builds a separator-tolerant pattern from word runs", () => {
    expect(multiWordTagPattern("Sales, Marketing & BD")).toBe(
      "Sales[\\s,&/–—-]+Marketing[\\s,&/–—-]+BD",
    );
  });
});
