import { describe, it, expect } from "vitest";
import {
  buildHighlightRegex,
  multiWordTagPattern,
  enhancementTagBody,
  ENHANCEMENT_SIGIL,
  ENHANCEMENT_SIGIL_RE,
} from "../tagHighlight";

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

  // Hyphen-joined variants are the form normalizeDescription's Pass 1 used to
  // rewrite to spaces. We now recognise them via the regex separator instead,
  // so a live editing backdrop highlights them WITHOUT mutating the characters
  // (which would drift the transparent-textarea caret in a proportional font).
  it("tolerates hyphen-joined multi-word names (#Quick-Policy)", () => {
    expect(matchedTags("- Enhancement #Quick-Policy - 30%", NAMES)).toEqual([
      "#Quick-Policy",
    ]);
  });

  it("tolerates hyphen-joined punctuated names (#Sales-Marketing-BD)", () => {
    expect(matchedTags("#Sales-Marketing-BD proposal", NAMES)).toEqual([
      "#Sales-Marketing-BD",
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

describe("enhancement sigil", () => {
  const ROSTER = ["AXA-MTC", "AXA-SMART CLAIMS"];

  /** Tokens the highlighter would mark, given both taxonomy and roster. */
  function marked(text: string): string[] {
    const re = buildHighlightRegex([], ROSTER);
    return [...text.matchAll(re)].map((m) => m[1]);
  }

  it("escapes a regex-metacharacter sigil", () => {
    // The current sigil is `$` — end-of-string in a regex. If the escape were
    // ever bypassed, every enhancement pattern would compile to an anchor and
    // match nothing at all, silently. This pins the behaviour down.
    const body = enhancementTagBody(["AXA-MTC"])!;
    const escaped = new RegExp(ENHANCEMENT_SIGIL_RE + body, "i");
    const raw = new RegExp(ENHANCEMENT_SIGIL + body, "i");

    expect(escaped.test("fix $AXA-MTC now")).toBe(true);
    // The unescaped form is exactly the bug this guards against.
    expect(raw.test("fix $AXA-MTC now")).toBe(false);
  });

  it("marks an enhancement token alongside #category and @client", () => {
    expect(marked("$AXA-MTC payout fix @AUII #Geniisys")).toEqual([
      "$AXA-MTC",
      "@AUII",
      "#Geniisys",
    ]);
  });

  it("matches a multi-word roster name as one token", () => {
    expect(marked("$AXA-SMART CLAIMS regression")).toEqual(["$AXA-SMART CLAIMS"]);
    // Separator-tolerant: a space in place of the hyphen still reads as one
    // token, so the highlight does not stop at the first word.
    expect(marked("$AXA SMART CLAIMS regression")).toEqual(["$AXA SMART CLAIMS"]);
  });

  it("highlights case-insensitively, matching the parser", () => {
    // The parser resolves tags case-insensitively; the highlighter now does
    // too, so a lowercase tag that WILL be tagged also shows colour. Before
    // this, "$axa smart claims" parsed fine but rendered plain — no feedback.
    expect(marked("$axa smart claims regression")).toEqual(["$axa smart claims"]);
    expect(marked("$AXA-MTC")).toEqual(["$AXA-MTC"]);
  });

  it("does not mark currency or off-roster names", () => {
    expect(marked("spent $500 on licences")).toEqual([]);
    expect(marked("billed $AXA for the work")).toEqual([]);
    expect(marked("$whatever")).toEqual([]);
  });

  it("is inert when no roster is supplied", () => {
    const re = buildHighlightRegex([]);
    expect([...("$AXA-MTC fix".matchAll(re))].map((m) => m[1])).toEqual([]);
  });
});
