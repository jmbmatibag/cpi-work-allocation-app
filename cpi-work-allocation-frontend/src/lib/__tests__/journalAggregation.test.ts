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

describe("aggregateJournalEntries — leaves bucket by Work Type", () => {
  it("keeps distinct leave types in separate cards", () => {
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "8:00 am to 5:00 pm Sick leave" },
      { date: "2026-07-02", content: "8:00 am to 5:00 pm Vacation leave" },
    ];

    const items = aggregateJournalEntries(entries, { knownClients: [] });

    // Sick and Vacation must NOT consolidate into one card.
    expect(items).toHaveLength(2);
    const texts = items.map((i) => i.bullets.join(" ").toLowerCase());
    expect(texts.some((t) => t.includes("sick"))).toBe(true);
    expect(texts.some((t) => t.includes("vacation"))).toBe(true);
  });

  it("merges case variants of the same leave type into one card", () => {
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "8:00 am to 5:00 pm sick leave" },
      { date: "2026-07-02", content: "8:00 am to 5:00 pm Sick Leave" },
      { date: "2026-07-03", content: "8:00 am to 5:00 pm SICK LEAVE" },
    ];

    const items = aggregateJournalEntries(entries, { knownClients: [] });

    // All three cased forms are the SAME leave type → one card, three days.
    expect(items).toHaveLength(1);
    expect(items[0].days).toHaveLength(3);
  });

  it("does not lump a generic 'on leave' in with a specific type", () => {
    const entries: JournalEntry[] = [
      { date: "2026-07-01", content: "8:00 am to 5:00 pm on leave" },
      { date: "2026-07-02", content: "8:00 am to 5:00 pm sick leave" },
    ];

    const items = aggregateJournalEntries(entries, { knownClients: [] });
    expect(items).toHaveLength(2);
  });
});

describe("formatAggregationAsPrompt — clean bullets for multi-word tags", () => {
  it("emits the full tag in the header and a clean bullet (no '& DEVELOPMENT' leak)", () => {
    const entries: JournalEntry[] = [
      {
        date: "2026-07-01",
        content:
          "1:00 pm to 2:00 pm #TRAINING & DEVELOPMENT Work Allocation App Pilot Testing Kick-off Meeting",
      },
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
    const prompt = formatAggregationAsPrompt(items, {
      knownCategories: KNOWN_CATEGORIES,
    });

    // The header carries the whole, un-truncated tag — ampersand intact.
    expect(prompt).toContain("#TRAINING & DEVELOPMENT");
    // The fractured form must be gone: no bullet begins with "& DEVELOPMENT".
    expect(prompt).not.toMatch(/--\s*& DEVELOPMENT/);
    // Bullets start at the real task text.
    expect(prompt).toContain("Work Allocation App Pilot Testing Kick-off Meeting");
    expect(prompt).toContain(
      "2nd COC: Cybersecurity and Information Security Refresher",
    );
    // No stray "#TRAINING" fragment remains inside a bullet body.
    expect(prompt).not.toMatch(/--\s*#?TRAINING(?!\s*&)/);
  });

  it("single-bullet bucket: tag preserved, body stripped clean", () => {
    const entries: JournalEntry[] = [
      {
        date: "2026-07-04",
        content:
          "3:00 pm to 4:30 pm #TRAINING & DEVELOPMENT 2nd COC: Cybersecurity Refresher",
      },
    ];

    const items = aggregateJournalEntries(entries, {
      knownClients: [],
      knownCategories: KNOWN_CATEGORIES,
    });
    const prompt = formatAggregationAsPrompt(items, {
      knownCategories: KNOWN_CATEGORIES,
    });

    // Whole line: leading "#TRAINING & DEVELOPMENT" tag intact, body clean.
    expect(prompt).toBe(
      "- #TRAINING & DEVELOPMENT 2nd COC: Cybersecurity Refresher - 100.00%",
    );
    // The truncated form ("#TRAINING" alone, then "2nd COC" as body) is gone.
    expect(prompt).not.toMatch(/#TRAINING\s+2nd/);
  });
});
