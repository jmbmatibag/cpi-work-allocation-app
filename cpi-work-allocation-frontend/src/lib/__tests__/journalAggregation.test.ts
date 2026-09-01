import { describe, it, expect } from "vitest";
import {
  aggregateJournalEntries,
  formatAggregationAsPrompt,
  type JournalEntry,
} from "../journalAggregation";

// ---------------------------------------------------------------------
// Multi-word #category tag extraction (user-reported "#TRAINING &
// DEVELOPMENT" fracture).
//
// Before the fix, the aggregator's hardcoded single-word category regex
// truncated "#TRAINING & DEVELOPMENT" to "#TRAINING", bucketing under the
// wrong category and leaking "& DEVELOPMENT 2nd COC…" into the bullet text:
//
//   #TRAINING Work:
//   -- & DEVELOPMENT 2nd COC: Cybersecurity and Information Security Refresher
//
// The fix threads the live taxonomy names (knownCategories) through
// extraction + stripping so the whole tag is recognised as one token.
// ---------------------------------------------------------------------

/** Sum of 2dp percentages, rounded back to 2dp (raw float sums are unsafe). */
const sumPct = (items: readonly { pct: number }[]): number =>
  Math.round(items.reduce((a, i) => a + i.pct, 0) * 100) / 100;

const KNOWN_CATEGORIES = [
  "TRAINING & DEVELOPMENT",
  "Sales, Marketing & BD",
  "General Work",
  "Projects",
  "Geniisys",
  "Quick Policy",
];

describe("aggregateJournalEntries — multi-word #category tags", () => {
  it("captures the whole '#TRAINING & DEVELOPMENT' tag (time-blocked entry)", () => {
    const entries: JournalEntry[] = [
      {
        date: "2026-07-04",
        content:
          "3:00 pm to 4:30 pm #TRAINING & DEVELOPMENT 2nd COC: Cybersecurity and Information Security Refresher",
      },
    ];

    const items = aggregateJournalEntries(entries, {
      knownClients: [],
      knownCategories: KNOWN_CATEGORIES,
    });

    expect(items).toHaveLength(1);
    // The full multi-word name drives the bucket — not the truncated form.
    expect(items[0].category).toBe("TRAINING & DEVELOPMENT");
  });

  it("truncates to a single word when knownCategories is NOT supplied (documents the old behaviour)", () => {
    const entries: JournalEntry[] = [
      {
        date: "2026-07-04",
        content:
          "3:00 pm to 4:30 pm #TRAINING & DEVELOPMENT 2nd COC: Cybersecurity Refresher",
      },
    ];

    const items = aggregateJournalEntries(entries, { knownClients: [] });
    expect(items[0].category).toBe("TRAINING");
  });

  it("still handles single-word tags unchanged (#Geniisys regression)", () => {
    const entries: JournalEntry[] = [
      {
        date: "2026-07-04",
        content: "9:00 am to 11:00 am #Geniisys sprint planning",
      },
    ];

    const items = aggregateJournalEntries(entries, {
      knownClients: [],
      knownCategories: KNOWN_CATEGORIES,
    });
    expect(items[0].category).toBe("Geniisys");
  });

  it("extracts the whole tag from a timeless (legacy) bullet line", () => {
    const entries: JournalEntry[] = [
      { date: "2026-07-04", content: "#Sales, Marketing & BD booth setup" },
    ];

    const items = aggregateJournalEntries(entries, {
      knownClients: [],
      knownCategories: KNOWN_CATEGORIES,
    });
    expect(items[0].category).toBe("Sales, Marketing & BD");
  });
});

describe("aggregateJournalEntries — non-working time is excluded", () => {
  it("drops leave/holiday units entirely (time-blocked entries)", () => {
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "8:00 am to 5:00 pm Sick leave" },
      { date: "2026-07-02", content: "8:00 am to 5:00 pm Vacation leave" },
    ];

    // Every unit is non-working, so nothing is left to allocate.
    expect(aggregateJournalEntries(entries, { knownClients: [] })).toEqual([]);
  });

  it("drops leave/holiday units entirely (legacy content entries)", () => {
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "- on leave" },
      { date: "2026-07-02", content: "- regular holiday" },
    ];

    expect(aggregateJournalEntries(entries, { knownClients: [] })).toEqual([]);
  });

  it("excludes leave minutes from the percentage weighting", () => {
    // Two identical 8h working days plus one 8h leave day. If the leave day
    // leaked into the weights the two work buckets would be 33.33% each;
    // excluded, they split the whole 100%.
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "8:00 am to 5:00 pm @ACME build the API" },
      { date: "2026-07-02", content: "8:00 am to 5:00 pm @GLOBEX write the docs" },
      { date: "2026-07-03", content: "8:00 am to 5:00 pm Sick leave" },
    ];

    const items = aggregateJournalEntries(entries, {
      knownClients: ["ACME", "GLOBEX"],
    });

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.client).sort()).toEqual(["ACME", "GLOBEX"]);
    expect(sumPct(items)).toBe(100);
    expect(items.every((i) => i.pct === 50)).toBe(true);
  });

  it("keeps real work on a day that also contains leave", () => {
    const entries: JournalEntry[] = [
      {
        date: "2026-07-01",
        content:
          "8:00 am to 12:00 pm @ACME ship the release" +
          "\n" +
          "1:00 pm to 5:00 pm half-day sick leave",
      },
    ];

    const items = aggregateJournalEntries(entries, { knownClients: ["ACME"] });

    expect(items).toHaveLength(1);
    expect(items[0].client).toBe("ACME");
    expect(items[0].bullets.join(" ").toLowerCase()).not.toContain("sick");
    expect(items[0].pct).toBe(100);
  });

  it("does not misclassify work that merely mentions a leave-like word", () => {
    // "Holiday Promo" is a project name, not time off — but the shared keyword
    // net is intentionally broad, so this documents the known trade-off.
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "8:00 am to 5:00 pm @ACME sprint planning" },
    ];

    const items = aggregateJournalEntries(entries, { knownClients: ["ACME"] });
    expect(items).toHaveLength(1);
  });
});

describe("formatAggregationAsPrompt — non-working time never reaches the summary", () => {
  it("omits leave bullets from the generated prompt text", () => {
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "8:00 am to 5:00 pm @ACME build the API" },
      { date: "2026-07-02", content: "8:00 am to 5:00 pm Vacation leave" },
    ];

    const items = aggregateJournalEntries(entries, { knownClients: ["ACME"] });
    const prompt = formatAggregationAsPrompt(items).toLowerCase();

    expect(prompt).toContain("build the api");
    expect(prompt).not.toContain("vacation");
    expect(prompt).not.toContain("leave");
  });
});
