import { describe, expect, it } from "vitest";
import {
  parseWorkAllocation,
  inferCategory,
  matchClient,
  DEFAULT_INFERENCE_RULES,
  type InferenceRule,
} from "../promptParser";
import {
  aggregateJournalEntries,
  formatAggregationAsPrompt,
} from "../journalAggregation";

const KNOWN_CLIENTS = ["AUII", "PNBGEN", "UCPB", "CIC"] as const;

const baseOptions = {
  defaultTeam: "IT/Platforms",
  knownClients: KNOWN_CLIENTS,
};

// ---------------------------------------------------------------------
// Simple format
// ---------------------------------------------------------------------

describe("parseWorkAllocation — simple format", () => {
  it("parses a single bullet with percentage", () => {
    const result = parseWorkAllocation(
      "- AWS migration planning - 40%",
      baseOptions,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      team: "IT/Platforms",
      workCategory: "IT",
      workType: "Infrastructure",
      percentage: 40,
    });
  });

  it("parses decimal percentages", () => {
    const result = parseWorkAllocation(
      "- Sprint planning meeting - 14.29%",
      baseOptions,
    );
    expect(result[0].percentage).toBe(14.29);
  });

  it("accepts em-dash, en-dash, hyphen, and colon as separators", () => {
    const separators = ["-", "–", "—", ":"];
    for (const sep of separators) {
      const result = parseWorkAllocation(
        `- AWS migration ${sep} 25%`,
        baseOptions,
      );
      expect(result).toHaveLength(1);
      expect(result[0].percentage).toBe(25);
    }
  });

  it("accepts percentage without the % sign", () => {
    const result = parseWorkAllocation(
      "- AWS migration - 25",
      baseOptions,
    );
    expect(result[0].percentage).toBe(25);
  });

  it("matches known clients case-insensitively", () => {
    const result = parseWorkAllocation(
      "- auii server migration - 30%",
      baseOptions,
    );
    expect(result[0].client).toBe("AUII");
  });

  it("falls back when no client keyword is present", () => {
    const result = parseWorkAllocation(
      "- internal planning session - 10%",
      baseOptions,
    );
    expect(result[0].client).toBe("N/A");
  });
});

// ---------------------------------------------------------------------
// Hierarchical format
// ---------------------------------------------------------------------

describe("parseWorkAllocation — hierarchical format", () => {
  it("parses a known-client header with percentage bullets", () => {
    const input = `AUII:
-- AWS migration - 20%
-- Security audit - 15%`;
    const result = parseWorkAllocation(input, baseOptions);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      client: "AUII",
      percentage: 35, // 20 + 15
    });
    expect(result[0].description).toContain("AWS migration");
    expect(result[0].description).toContain("Security audit");
  });

  it("uses the header text as a custom client when no match", () => {
    const input = `Acme Widgets:
-- discovery workshop - 10%`;
    const result = parseWorkAllocation(input, baseOptions);
    expect(result[0].client).toBe("Acme Widgets");
  });

  it("collects bullets without percentages", () => {
    const input = `AUII:
-- preliminary scoping
-- stakeholder interviews`;
    const result = parseWorkAllocation(input, baseOptions);
    expect(result).toHaveLength(1);
    expect(result[0].percentage).toBe(0);
    expect(result[0].description).toContain("preliminary scoping");
  });
});

// ---------------------------------------------------------------------
// Regression: bare-number bullet must not be read as a percentage
// (the `-- 41631` bug that produced a 41637.53% ABIC card / 41731% ring)
// ---------------------------------------------------------------------

describe("parseWorkAllocation — bare-number bullet regression", () => {
  it("ignores a bare SR number and uses only the trailing % (6.53)", () => {
    const input = `@ABIC #Geniisys:
-- support for
-- 41631
-- SA Deployment and testing
-- SR 41631
-- Test Annualized Amounts
-- SR 39715
-- Other QA queries and testings
-- Bulletin and recreation
-- Bulletin
-- support
-- Other query by sir Carl - 6.53%`;
    const result = parseWorkAllocation(input, {
      ...baseOptions,
      knownClients: ["ABIC"],
    });
    expect(result).toHaveLength(1);
    expect(result[0].percentage).toBe(6.53);
    // The bare number survives as description content, not a percentage.
    expect(result[0].description).toContain("41631");
  });

  it("keeps a block percentage bounded even if bullets carry huge %", () => {
    const input = `@ABIC #Geniisys:
-- glitch - 41631%
-- Other query - 6.53%`;
    const result = parseWorkAllocation(input, {
      ...baseOptions,
      knownClients: ["ABIC"],
    });
    expect(result[0].percentage).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------
// Structured format
// ---------------------------------------------------------------------

describe("parseWorkAllocation — structured format", () => {
  it("parses explicit team/category/workType/client fields", () => {
    const input =
      "HR (team), HR (work category), Recruitment (work type), Internal (client), Conducted 5 technical interviews - 25%";
    const result = parseWorkAllocation(input, baseOptions);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      team: "HR",
      workCategory: "HR",
      subCategory: null,
      workType: "Recruitment",
      client: "Internal",
      description: "Conducted 5 technical interviews",
      percentage: 25,
    });
  });
});

// ---------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------

describe("parseWorkAllocation — edges", () => {
  it("returns [] for empty string", () => {
    expect(parseWorkAllocation("", baseOptions)).toEqual([]);
  });

  it("returns [] for whitespace only", () => {
    expect(parseWorkAllocation("   \n\n  \t  ", baseOptions)).toEqual([]);
  });

  it("ignores lines without a percentage in simple format", () => {
    expect(
      parseWorkAllocation(
        "- Standup meeting with team\n- Sprint planning - 20%",
        baseOptions,
      ),
    ).toHaveLength(1);
  });

  it("mixes simple and hierarchical formats in one input", () => {
    const input = `AUII:
-- AWS migration - 40%
- Sprint planning - 20%`;
    const result = parseWorkAllocation(input, baseOptions);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.client === "AUII")).toBeDefined();
    expect(result.find((r) => r.percentage === 20)).toBeDefined();
  });

  it("uses defaultTeam when the caller specifies no team override", () => {
    const result = parseWorkAllocation(
      "- AWS migration - 25%",
      { defaultTeam: "Custom Team", knownClients: KNOWN_CLIENTS },
    );
    expect(result[0].team).toBe("Custom Team");
  });
});

// ---------------------------------------------------------------------
// m365 regression — this keyword used to route to HR/Recruitment,
// it belongs in IT/Infrastructure.
// ---------------------------------------------------------------------

describe("inferCategory — m365 regression", () => {
  it("classifies m365 as IT Infrastructure, not HR", () => {
    expect(inferCategory("m365 tenant migration")).toEqual({
      category: "IT",
      subCategory: null,
      workType: "Infrastructure",
    });
    expect(inferCategory("M365 Tenant Migration")).toEqual({
      category: "IT",
      subCategory: null,
      workType: "Infrastructure",
    });
  });

  it("also classifies microsoft 365 and o365 as IT Infrastructure", () => {
    expect(inferCategory("microsoft 365 licensing review").category).toBe("IT");
    expect(inferCategory("o365 group policy tuning").category).toBe("IT");
  });

  it("still classifies recruitment as HR", () => {
    expect(inferCategory("candidate interview prep")).toEqual({
      category: "HR",
      subCategory: null,
      workType: "Recruitment",
    });
  });
});

// ---------------------------------------------------------------------
// tech-lead regression — "1:1 with @AUII tech lead #General" was
// misclassified as BD/Mktg/Sales > Lead Generation because the bare
// word "lead" triggered the sales rule. The fix: word-boundary match
// on single-word keywords, and the bare "lead" keyword was removed
// from the Lead Generation rule in favor of "lead generation" /
// "sales lead" / "prospect".
// ---------------------------------------------------------------------

describe("inferCategory — tech-lead regression", () => {
  it("does not classify '1:1 with tech lead' as Lead Generation", () => {
    const result = inferCategory("1:1 with tech lead");
    expect(result.category).not.toBe("BD/Mktg/Sales");
    // "1:1" and "tech lead" both route to General Work / Meetings.
    expect(result).toEqual({
      category: "General Work",
      subCategory: null,
      workType: "Meetings",
    });
  });

  it("still classifies 'lead generation effort' as Lead Generation", () => {
    expect(inferCategory("lead generation effort for Q2")).toEqual({
      category: "Sales, Marketing & BD",
      subCategory: null,
      workType: "Lead Generation",
    });
  });

  it("classifies 'team lead catchup' as a meeting, not sales", () => {
    expect(inferCategory("team lead catchup").category).toBe("General Work");
  });

  it("word-boundary: 'leaderboard review' does not fire on 'lead'", () => {
    // 'leaderboard' contains 'lead' as a prefix. Pre-fix, this would
    // have matched the BD/Mktg/Sales "lead" keyword. With the keyword
    // removed AND with word-boundary matching, it must not.
    const result = inferCategory("leaderboard review");
    expect(result.category).not.toBe("BD/Mktg/Sales");
  });
});

describe("parseWorkAllocation — #Category tag honoring", () => {
  it("uses the #Category tag instead of keyword inference when present", () => {
    const result = parseWorkAllocation(
      "- 1:1 with @AUII tech lead #General - 6%",
      baseOptions,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      workCategory: "General Work",
      client: "AUII",
      percentage: 6,
    });
  });

  it("honors #IT over keyword inference", () => {
    const result = parseWorkAllocation(
      "- Routine maintenance task #IT - 10%",
      baseOptions,
    );
    expect(result[0].workCategory).toBe("IT");
  });

  it("honors #Projects", () => {
    const result = parseWorkAllocation(
      "- Random work item #Projects - 10%",
      baseOptions,
    );
    expect(result[0].workCategory).toBe("Projects");
  });

  it("falls back to keyword inference when no #tag is present", () => {
    const result = parseWorkAllocation(
      "- AWS migration planning - 25%",
      baseOptions,
    );
    expect(result[0].workCategory).toBe("IT");
    expect(result[0].workType).toBe("Infrastructure");
  });
});

// ---------------------------------------------------------------------
// Rule injection — callers can pass their own rules
// ---------------------------------------------------------------------

describe("parseWorkAllocation — rule injection", () => {
  it("uses caller-supplied inference rules over the defaults", () => {
    const customRules: InferenceRule[] = [
      { keywords: ["aws"], category: "Cloud Ops", workType: "Platform" },
    ];
    const result = parseWorkAllocation("- AWS migration - 40%", {
      ...baseOptions,
      inferenceRules: customRules,
    });
    expect(result[0].workCategory).toBe("Cloud Ops");
    expect(result[0].workType).toBe("Platform");
  });

  it("falls back to General Work/Administrative when no rules match", () => {
    expect(inferCategory("something totally unfamiliar", [])).toEqual({
      category: "General Work",
      subCategory: null,
      workType: "Administrative",
    });
  });
});

// ---------------------------------------------------------------------
// matchClient standalone
// ---------------------------------------------------------------------

describe("matchClient", () => {
  it("matches any known client case-insensitively", () => {
    expect(matchClient("working on auii stuff", ["AUII"])).toBe("AUII");
    expect(matchClient("PNBGEN integration", ["AUII", "PNBGEN"])).toBe("PNBGEN");
  });

  it("returns the configured fallback when no known client matches", () => {
    expect(matchClient("nothing here", ["AUII"], "Internal")).toBe("Internal");
  });

  it("returns 'N/A' by default when no fallback is given", () => {
    expect(matchClient("nothing here", ["AUII"])).toBe("N/A");
  });
});

// ---------------------------------------------------------------------
// Round-trip — the HITL contract.
// aggregateJournalEntries produces a prompt text via
// formatAggregationAsPrompt. That text is what the user sees and may
// edit before hitting submit. parseWorkAllocation must round-trip
// the (client, percentage) pairs faithfully so the cards match the
// aggregator's intent.
//
// We don't assert on workCategory here because the parser
// keyword-infers it while the aggregator may pick it up from a #tag
// — that drift is a known gap closing in Phase G.
// ---------------------------------------------------------------------

describe("round-trip: journal aggregation → prompt → parse", () => {
  it("preserves (client, percentage) across the round-trip", () => {
    const entries = [
      { date: "2026-04-01", content: "@AUII AWS migration planning" },
      { date: "2026-04-02", content: "@AUII AWS migration planning" },
      { date: "2026-04-03", content: "@PNBGEN claims module development" },
      { date: "2026-04-04", content: "sprint standup meeting" },
      { date: "2026-04-05", content: "@AUII security audit" },
    ];

    const aggregated = aggregateJournalEntries(entries, {
      knownClients: KNOWN_CLIENTS,
    });
    const promptText = formatAggregationAsPrompt(aggregated);

    const parsed = parseWorkAllocation(promptText, {
      defaultTeam: "IT/Platforms",
      knownClients: KNOWN_CLIENTS,
      // Match aggregation's default so unlabeled "Internal" tasks
      // round-trip to the same client label.
      fallbackClient: "Internal",
    });

    expect(parsed).toHaveLength(aggregated.length);

    // Total percentage should round-trip to exactly 100 (distributePercentages guarantee).
    const parsedTotal = parsed.reduce((s, p) => s + p.percentage, 0);
    expect(Math.round(parsedTotal * 100) / 100).toBe(100);

    // Every aggregated (client, pct) pair appears in the parsed output.
    for (const item of aggregated) {
      const match = parsed.find(
        (p) => p.client === item.client && p.percentage === item.pct,
      );
      expect(
        match,
        `missing round-trip match for client=${item.client} pct=${item.pct}`,
      ).toBeDefined();
    }
  });

  it("consolidates same-tagged entries across days into a single card", () => {
    // 7 entries, all @AUII #IT, one day each. The new aggregator
    // buckets by (client, category) and consolidates — 7 days of AUII
    // IT work become ONE card worth 100%, not seven cards at ~14.29%.
    // This is the central behavior change vs. the pre-consolidation
    // aggregator.
    const entries = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-04-0${i + 1}`,
      content: `- @AUII AWS migration task ${i + 1} #IT`,
    }));

    const aggregated = aggregateJournalEntries(entries, {
      knownClients: KNOWN_CLIENTS,
    });
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].client).toBe("AUII");
    expect(aggregated[0].category).toBe("IT");
    expect(aggregated[0].days).toHaveLength(7);
    expect(aggregated[0].pct).toBe(100);
    // All 7 distinct task variations preserved as bullets.
    expect(aggregated[0].bullets).toHaveLength(7);

    const promptText = formatAggregationAsPrompt(aggregated);
    const parsed = parseWorkAllocation(promptText, {
      defaultTeam: "IT/Platforms",
      knownClients: KNOWN_CLIENTS,
      fallbackClient: "Internal",
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0].percentage).toBe(100);
    expect(parsed[0].client).toBe("AUII");
  });

  it("equal-split math survives across 7 distinct buckets", () => {
    // 7 entries, each a different (client, category) pair, one day
    // each → 7 buckets, percentages [14.29 × 6, 14.26] via Hamilton
    // (sum exactly 100). Round-trip must preserve the total.
    const entries = [
      { date: "2026-04-01", content: "- @AUII AWS migration #IT" },
      { date: "2026-04-02", content: "- @PNBGEN claims dev #Projects" },
      { date: "2026-04-03", content: "- @UCPB code review #Projects" },
      { date: "2026-04-04", content: "- @CIC security audit #IT" },
      { date: "2026-04-05", content: "- @AUII sprint planning #General" },
      { date: "2026-04-06", content: "- CCNA training #General" },
      { date: "2026-04-07", content: "- interview prep #HR" },
    ];

    const aggregated = aggregateJournalEntries(entries, {
      knownClients: KNOWN_CLIENTS,
    });
    expect(aggregated).toHaveLength(7);

    const promptText = formatAggregationAsPrompt(aggregated);
    const parsed = parseWorkAllocation(promptText, {
      defaultTeam: "IT/Platforms",
      knownClients: KNOWN_CLIENTS,
      fallbackClient: "Internal",
    });

    const total = parsed.reduce((s, p) => s + p.percentage, 0);
    expect(Math.round(total * 100) / 100).toBe(100);
    expect(parsed).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------
// Phase P — sub-category tags + three-level hierarchy
// ---------------------------------------------------------------------

import type { TaxonomySnapshot } from "../promptParser";

const phasePTaxonomy: TaxonomySnapshot = {
  subCategoryToMain: {
    Geniisys: "Projects",
    "Quick Policy": "Projects",
  },
  defaultWorkTypeByParent: {
    "General Work": "Meetings",
    Projects: "Development",
    HR: "Recruitment",
    IT: "Infrastructure",
    "Sales, Marketing & BD": "Marketing Campaign",
    Finance: "Reporting",
    Geniisys: "Implementation",
    "Quick Policy": "Implementation",
  },
  workTypesByParent: {
    "General Work": ["Administrative", "Meetings", "Training", "Documentation", "Communication", "Research"],
    Projects: ["Development", "Testing", "Deployment", "Planning", "Review", "Support"],
    HR: ["Recruitment", "Onboarding", "Policy", "Compliance", "Engagement", "Benefits"],
    IT: ["Infrastructure", "Security", "DevOps", "Helpdesk", "Networking", "Monitoring"],
    "Sales, Marketing & BD": ["Lead Generation", "Client Relations", "Proposals", "Marketing Campaign", "Sales"],
    Finance: ["Budgeting", "Reporting", "Audit", "Forecasting"],
    Geniisys: ["Implementation", "Enhancement", "Maintenance", "Product Development", "Support", "Testing", "Planning", "Meetings", "Documentation"],
    "Quick Policy": ["Implementation", "Product Development", "Support", "Enhancement", "Planning", "Meetings"],
  },
};

const phasePOptions = {
  defaultTeam: "IT/Platforms",
  knownClients: ["AUII", "Meridian"],
  fallbackClient: "N/A",
  taxonomy: phasePTaxonomy,
};

describe("Phase P — sub-category tag resolution", () => {
  it("#Geniisys resolves to Projects main + Geniisys sub", () => {
    const result = parseWorkAllocation(
      "- Implementation kickoff #Geniisys - 40%",
      phasePOptions,
    );
    expect(result[0]).toMatchObject({
      workCategory: "Projects",
      subCategory: "Geniisys",
      workType: "Implementation",
    });
  });

  it("#Quick Policy resolves to Projects main + Quick Policy sub", () => {
    const result = parseWorkAllocation(
      "- Enhancement work #Quick Policy - 30%",
      phasePOptions,
    );
    expect(result[0].workCategory).toBe("Projects");
    expect(result[0].subCategory).toBe("Quick Policy");
  });

  it("#Projects (main cat only) has subCategory null", () => {
    const result = parseWorkAllocation(
      "- Sprint kickoff #Projects - 20%",
      phasePOptions,
    );
    expect(result[0].workCategory).toBe("Projects");
    expect(result[0].subCategory).toBeNull();
  });

  it("#Projects/Geniisys path form resolves correctly", () => {
    const result = parseWorkAllocation(
      "- Scoping session #Projects/Geniisys - 25%",
      phasePOptions,
    );
    expect(result[0].workCategory).toBe("Projects");
    expect(result[0].subCategory).toBe("Geniisys");
  });

  it("#HR resolves main-only (no sub cats under HR)", () => {
    const result = parseWorkAllocation(
      "- Candidate interview #HR - 10%",
      phasePOptions,
    );
    expect(result[0].workCategory).toBe("HR");
    expect(result[0].subCategory).toBeNull();
  });

  it("No tag → inference fills workCategory, subCategory null", () => {
    const result = parseWorkAllocation(
      "- AWS infrastructure migration - 60%",
      phasePOptions,
    );
    expect(result[0].workCategory).toBe("IT");
    expect(result[0].subCategory).toBeNull();
  });

  it("Case-insensitive sub tag: #geniisys works", () => {
    const result = parseWorkAllocation(
      "- Work #geniisys - 50%",
      phasePOptions,
    );
    expect(result[0].subCategory).toBe("Geniisys");
  });

  it("Hierarchical header with sub tag", () => {
    const result = parseWorkAllocation(
      "#Geniisys Work:\n-- Implementation - 20%\n-- Testing - 10%",
      phasePOptions,
    );
    expect(result).toHaveLength(1);
    expect(result[0].workCategory).toBe("Projects");
    expect(result[0].subCategory).toBe("Geniisys");
    expect(result[0].percentage).toBe(30);
  });

  it("Legacy #bdmktg short-code still resolves post-Phase-P", () => {
    const result = parseWorkAllocation(
      "- Campaign prep #bdmktg - 15%",
      phasePOptions,
    );
    expect(result[0].workCategory).toBe("Sales, Marketing & BD");
    expect(result[0].subCategory).toBeNull();
  });

  it("Without taxonomy, dynamic sub-cat tags fall through to legacy map", () => {
    const result = parseWorkAllocation(
      "- Implementation #Geniisys - 40%",
      { defaultTeam: "IT/Platforms", knownClients: [], fallbackClient: "N/A" },
    );
    expect(result[0].workCategory).toBe("Projects");
    expect(result[0].subCategory).toBe("Geniisys");
  });

  it("All ParsedTasks include subCategory field", () => {
    const result = parseWorkAllocation(
      "- Task one - 10%\n- Task two #Geniisys - 20%",
      phasePOptions,
    );
    expect(result).toHaveLength(2);
    expect("subCategory" in result[0]).toBe(true);
    expect("subCategory" in result[1]).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Multi-word tags with special characters (commas, ampersands) and
// tolerant whitespace. Regression for the live bug where typing
// "#Sales, Marketing & BD" only captured "#Sales", breaking auto-
// categorization after the taxonomy was renamed from "BD/Mktg/Sales".
// ---------------------------------------------------------------------

const punctTaxonomy: TaxonomySnapshot = {
  subCategoryToMain: {
    Geniisys: "Projects",
    "Quick Policy": "Projects",
  },
  defaultWorkTypeByParent: {
    "General Work": "Meetings",
    Projects: "Development",
    "Sales, Marketing & BD": "Marketing Campaign",
    Geniisys: "Implementation",
    "Quick Policy": "Implementation",
  },
  workTypesByParent: {
    "Sales, Marketing & BD": [
      "Lead Generation",
      "Client Relations",
      "Proposals",
      "Marketing Campaign",
      "Sales",
    ],
    Geniisys: ["Implementation", "Enhancement", "Testing"],
    "Quick Policy": ["Implementation", "Enhancement"],
  },
};

const punctOptions = {
  defaultTeam: "BD/Mktg/Sales",
  knownClients: ["AUII", "Meridian"],
  fallbackClient: "N/A",
  taxonomy: punctTaxonomy,
};

describe("Multi-word tags with punctuation + tolerant whitespace", () => {
  it("canonical form: #Sales, Marketing & BD resolves the whole tag", () => {
    const result = parseWorkAllocation(
      "- Booth setup #Sales, Marketing & BD - 40%",
      punctOptions,
    );
    expect(result[0].workCategory).toBe("Sales, Marketing & BD");
    expect(result[0].subCategory).toBeNull();
  });

  it("missing space after comma: #Sales,Marketing & BD still resolves", () => {
    const result = parseWorkAllocation(
      "- Booth setup #Sales,Marketing & BD - 40%",
      punctOptions,
    );
    expect(result[0].workCategory).toBe("Sales, Marketing & BD");
  });

  it("extra whitespace padding around separators still resolves", () => {
    const result = parseWorkAllocation(
      "- Booth setup #Sales ,  Marketing  &  BD - 40%",
      punctOptions,
    );
    expect(result[0].workCategory).toBe("Sales, Marketing & BD");
  });

  it("degrades gracefully: unknown text after # falls back to single word", () => {
    const result = parseWorkAllocation(
      "- Prospecting #Sales pitch to Meridian - 25%",
      punctOptions,
    );
    // "#Sales" is not a known taxonomy name here (the main cat is the full
    // punctuated name), so no multi-word collapse happens and classification
    // falls through to keyword inference rather than mis-tagging.
    expect(result[0].workCategory).not.toBe("Projects");
  });

  it("still resolves plain multi-word names (#Quick Policy) unchanged", () => {
    const result = parseWorkAllocation(
      "- Enhancement work #Quick Policy - 30%",
      punctOptions,
    );
    expect(result[0].workCategory).toBe("Projects");
    expect(result[0].subCategory).toBe("Quick Policy");
  });
});

// ---------------------------------------------------------------------
// Phase P bug fix — hybrid tag + keyword resolution for work type
// ---------------------------------------------------------------------
// Regression: user reported that
//   "@AUII Geniisys Implementation for Client #Geniisys - 2.56%"
// was classified as workType: "Meetings" in the live Workspace
// because the tag pinned the parent to Geniisys and the parent's
// default (derived from the order work types are declared) was
// "Meetings" — Meetings lists Geniisys among its 7 parents and
// sits early in the seed list, beating Implementation.
//
// Fix: run inference over the description and accept the inferred
// work type when it's valid under the tag-resolved parent. Here
// the test taxonomy's Geniisys default is "Implementation" (the
// real seed in Workspace builds the default differently because
// of cross-cutting work types like Meetings — the live snapshot
// is what exposed the bug). These tests cover the hybrid mechanism
// itself, not the seed ordering.
//
// Note: the current DEFAULT_INFERENCE_RULES route the keyword
// "implementation" to workType "Development", which is NOT valid
// under Geniisys. So "implementation" keyword is rejected by the
// hybrid constraint and we fall back to the Geniisys default
// (Implementation in this fixture). That's the correct behavior:
// the inference rules target the flat main-category taxonomy and
// don't know about sub categories. Keywords like "testing" and
// "planning" route to work types (Testing, Planning) that ARE
// valid under Geniisys, so those demonstrate hybrid refinement.

describe("Phase P hybrid tag + inference — work type refinement", () => {
  it("tag sets parent; keyword 'testing' refines work type to Testing", () => {
    // "testing" keyword → workType: "Testing". Valid under Geniisys.
    // Hybrid accepts it and overrides the parent default.
    const result = parseWorkAllocation(
      "- End-to-end testing sweep #Geniisys - 25%",
      phasePOptions,
    );
    expect(result[0]).toMatchObject({
      workCategory: "Projects",
      subCategory: "Geniisys",
      workType: "Testing",
    });
  });

  it("tag sets parent; keyword 'planning' refines work type to Planning", () => {
    const result = parseWorkAllocation(
      "- Sprint planning and kickoff #Geniisys - 15%",
      phasePOptions,
    );
    expect(result[0].workType).toBe("Planning");
  });

  it("leaves work type BLANK when no description keyword matches", () => {
    // Product decision: no keyword match → empty work type (never a guessed
    // default), so the gap is visible to the user and their reviewing manager.
    const result = parseWorkAllocation(
      "- Work #Geniisys - 50%",
      phasePOptions,
    );
    expect(result[0].subCategory).toBe("Geniisys");
    expect(result[0].workType).toBe("");
  });

  it("leaves work type BLANK when the matched work type isn't valid under the tagged parent", () => {
    // "security" inference rule targets IT/Security; "review" targets
    // Projects/Review. Tag says Geniisys, which lists neither Security nor
    // Review, so no selectable work type matches → blank (not a default).
    const result = parseWorkAllocation(
      "- Security review #Geniisys - 20%",
      phasePOptions,
    );
    expect(result[0].subCategory).toBe("Geniisys");
    expect(result[0].workType).toBe("");
  });

  it("hierarchical header with tag — keyword refinement applies to bullets", () => {
    // Combined header+bullets text: "#Geniisys Work End-to-end testing Review session"
    // "testing" keyword fires → Testing, which is valid under Geniisys.
    const result = parseWorkAllocation(
      "#Geniisys Work:\n-- End-to-end testing sweep - 20%\n-- Review session - 10%",
      phasePOptions,
    );
    expect(result[0].workType).toBe("Testing");
  });
});

// ---------------------------------------------------------------------
// User-reported regression — verbatim case
// ---------------------------------------------------------------------
// Screenshot showed:
//   "@AUII #Geniisys Implementation of SR. 2345 for client" -> Meetings
// Expected: workType = Implementation
//
// Root cause was two-fold:
//   1. The "implementation" keyword routed to workType "Development",
//      not "Implementation" — stale rule from pre-Phase-P taxonomy
//   2. When hybrid refinement rejected Development (not valid under
//      Geniisys), fallback picked the "first listed" work type,
//      which was Meetings (listed Geniisys among 7 parents)

describe("Phase P — verbatim user-reported cases", () => {
  it("@AUII #Geniisys Implementation ... resolves to Implementation", () => {
    const result = parseWorkAllocation(
      "- @AUII #Geniisys Implementation of SR. 2345 for client - 100%",
      phasePOptions,
    );
    expect(result[0]).toMatchObject({
      workCategory: "Projects",
      subCategory: "Geniisys",
      workType: "Implementation",
      client: "AUII",
    });
  });

  it("variant with lowercase tag and leading @-client", () => {
    const result = parseWorkAllocation(
      "- @auii Implementation for client #geniisys - 40%",
      phasePOptions,
    );
    expect(result[0].workType).toBe("Implementation");
    expect(result[0].subCategory).toBe("Geniisys");
  });

  it("'implement' keyword (not just 'implementation') routes the same", () => {
    const result = parseWorkAllocation(
      "- Implement new feature for @AUII #Geniisys - 30%",
      phasePOptions,
    );
    // "implement" triggers the Implementation rule; "feature" would
    // have triggered Development but Development isn't valid under
    // Geniisys so hybrid would reject it anyway. The higher-scoring
    // rule wins — depends on which has more matches. Here both
    // rules score 1 each, so first-declared wins (Development).
    // Since Development isn't valid under Geniisys, it falls back to
    // the specialization-sorted default, which is Implementation.
    expect(result[0].workType).toBe("Implementation");
    expect(result[0].subCategory).toBe("Geniisys");
  });
});

// ---------------------------------------------------------------------
// Keyword stemming — natural language suffix matching
// ---------------------------------------------------------------------
// Regression: user wrote "@AUII #Geniisys enhancements of SR" and
// got workType = Implementation (default fallback). Root cause was
// matchesKeyword enforcing a right-side word boundary, so "enhance"
// didn't match "enhancements". That broke keyword inference for
// every plural/conjugation — "planning" didn't match "plannings",
// "coding" didn't match "codings", etc.
//
// Fix: matchesKeyword keeps the left-side word boundary but drops
// the right-side one. "enhance" matches "enhance/enhanced/
// enhancing/enhancements".

describe("Keyword stemming — plural and conjugation suffixes", () => {
  it("'enhancements' (plural) matches 'enhance' keyword", () => {
    const r = inferCategory("working on enhancements for client");
    expect(r.workType).toBe("Enhancement");
  });

  it("'implementing' (gerund) matches 'implement' keyword", () => {
    const r = inferCategory("implementing new module");
    expect(r.workType).toBe("Implementation");
  });

  it("'developed' (past) matches 'develop' stem via 'development'", () => {
    // Rule has "development", "coding", "feature". "developed" has
    // "develop" stem but not "development". Test: that "development"
    // correctly still matches "developmental" (left-bounded).
    const r = inferCategory("developmental feature work");
    expect(r.workType).toBe("Development");
  });

  it("user's reported case — #Geniisys enhancements lands on Enhancement", () => {
    const r = parseWorkAllocation(
      "- @AUII #Geniisys enhancements of SR. 2345 for client - 100%",
      phasePOptions,
    );
    expect(r[0]).toMatchObject({
      workCategory: "Projects",
      subCategory: "Geniisys",
      workType: "Enhancement",
      client: "AUII",
    });
  });

  it("left boundary still strict — 'aeroplanning' does NOT match 'plan'", () => {
    // "plan" is not a keyword, but "planning" is. Test that
    // "aeroplanning" (contains 'planning' as substring) doesn't
    // falsely match — left boundary prevents it.
    const r = inferCategory("aeroplanning is a real word");
    // Should NOT match "planning" rule → falls to General Work default
    expect(r.workType).not.toBe("Planning");
  });
});

// ---------------------------------------------------------------------
// Live regression — the "#Geniisys devops management" → "Debugging" bug.
// ---------------------------------------------------------------------
// In production, auto-generated rules embed the sub-category name as a
// keyword (e.g. "geniisys"). When the user tags #Geniisys, that shared
// keyword matches EVERY Geniisys rule equally, so a rule with no other
// matching keyword (Debugging) could tie and win by declaration order —
// even though "devops management" is right there in the text and there is
// a DevOps Management rule + work type. The parent keyword must not count.
describe("Live regression — tagged sub-category work-type selection", () => {
  const geniisysTaxonomy: TaxonomySnapshot = {
    subCategoryToMain: { Geniisys: "Projects" },
    defaultWorkTypeByParent: { Projects: "Development", Geniisys: "Debugging" },
    workTypesByParent: {
      Projects: ["Development", "Testing"],
      // "Debugging" is listed first — the pre-fix default/tie would pick it.
      // "Meetings" is valid here but its rule lives under General Work below.
      Geniisys: ["Debugging", "DevOps Management", "Enhancement", "Testing", "Meetings"],
    },
  };
  // Auto-generated-style rules: each carries the parent name "geniisys" plus
  // the tokenized work-type name. NOTE the Meetings rule is stored under a
  // DIFFERENT category (General Work) — the real-world case that used to be
  // scoped out and always come back blank under #Geniisys.
  const geniisysRules: InferenceRule[] = [
    { keywords: ["debugging", "debug", "geniisys"], category: "Projects", subCategory: "Geniisys", workType: "Debugging" },
    { keywords: ["devops management", "devops", "management", "geniisys"], category: "Projects", subCategory: "Geniisys", workType: "DevOps Management" },
    { keywords: ["enhancement", "enhance", "geniisys"], category: "Projects", subCategory: "Geniisys", workType: "Enhancement" },
    { keywords: ["meeting", "standup", "sync"], category: "General Work", workType: "Meetings" },
  ];
  const opts = {
    defaultTeam: "IT/Platforms",
    knownClients: ["AFPGEN"],
    fallbackClient: "N/A",
    taxonomy: geniisysTaxonomy,
    inferenceRules: geniisysRules,
  };

  it("'#Geniisys devops management @AFPGEN' resolves to DevOps Management, not Debugging", () => {
    const r = parseWorkAllocation("- #Geniisys devops management @AFPGEN - 100%", opts);
    expect(r[0]).toMatchObject({
      workCategory: "Projects",
      subCategory: "Geniisys",
      workType: "DevOps Management",
      client: "AFPGEN",
    });
  });

  it("only the shared parent keyword present → work type BLANK (no guessed default)", () => {
    // "geniisys" is the only matching keyword; it's excluded from scoring, so
    // nothing work-type-specific matched → blank, NOT the "Debugging" default.
    const r = parseWorkAllocation("- #Geniisys work for @AFPGEN - 100%", opts);
    expect(r[0].subCategory).toBe("Geniisys");
    expect(r[0].workType).toBe("");
  });

  it("stemmed variant 'debugging the module' still lands on Debugging", () => {
    const r = parseWorkAllocation("- #Geniisys debugging the login module - 50%", opts);
    expect(r[0].workType).toBe("Debugging");
  });

  it("cross-category work type: '#Geniisys team meeting' → Meetings (rule stored under General Work)", () => {
    // Meetings is valid under Geniisys but its rule's category is General Work.
    // Scoping candidates by work-type validity (not stored category) is what
    // lets this resolve instead of coming back blank.
    const r = parseWorkAllocation("- #Geniisys team meeting sync @CIC - 100%", opts);
    expect(r[0].subCategory).toBe("Geniisys");
    expect(r[0].workType).toBe("Meetings");
  });

  it("Scenario-A client rules don't force a work type: bare @client → BLANK", () => {
    // Real DBs also hold client rules keyed on [client, subCategory] for every
    // linked work type. With no work-type keyword in the text, only the client
    // code + parent name match — both excluded — so the result must be blank,
    // not whichever client rule happens to be declared first.
    const clientRuleOpts = {
      ...opts,
      inferenceRules: [
        { keywords: ["afpgen", "geniisys"], category: "Projects", subCategory: "Geniisys", workType: "Debugging" },
        { keywords: ["afpgen", "geniisys"], category: "Projects", subCategory: "Geniisys", workType: "DevOps Management" },
        ...geniisysRules,
      ] as InferenceRule[],
    };
    const r = parseWorkAllocation("- #Geniisys handled items for @AFPGEN - 100%", clientRuleOpts);
    expect(r[0].client).toBe("AFPGEN");
    expect(r[0].workType).toBe("");
  });
});

// ---------------------------------------------------------------------
// Universality — the same rules apply to EVERY category and sub-category,
// not just Geniisys. These use the shared phasePTaxonomy/phasePOptions
// (HR, IT, Projects, Quick Policy, …) with the default rule set to prove
// there is no parent-specific behavior.
// ---------------------------------------------------------------------
describe("Work-type selection is parent-agnostic (all categories & sub-categories)", () => {
  it("main-category parent #HR: keyword match → correct work type", () => {
    const r = parseWorkAllocation(
      "- #HR recruitment and candidate interviews - 100%",
      phasePOptions,
    );
    expect(r[0].workCategory).toBe("HR");
    expect(r[0].subCategory).toBeNull();
    expect(r[0].workType).toBe("Recruitment");
  });

  it("main-category parent #IT: keyword match → correct work type", () => {
    const r = parseWorkAllocation(
      "- #IT firewall security audit - 100%",
      phasePOptions,
    );
    expect(r[0].workCategory).toBe("IT");
    expect(r[0].workType).toBe("Security");
  });

  it("main-category parent #HR: no matching keyword → BLANK (not a default)", () => {
    const r = parseWorkAllocation(
      "- #HR miscellaneous odds and ends - 100%",
      phasePOptions,
    );
    expect(r[0].workCategory).toBe("HR");
    expect(r[0].workType).toBe("");
  });

  it("different sub-category #Quick Policy: keyword match → correct work type", () => {
    const r = parseWorkAllocation(
      "- #Quick Policy enhancement work - 100%",
      phasePOptions,
    );
    expect(r[0].subCategory).toBe("Quick Policy");
    expect(r[0].workType).toBe("Enhancement");
  });

  it("different sub-category #Quick Policy: no matching keyword → BLANK", () => {
    const r = parseWorkAllocation(
      "- #Quick Policy general odds and ends - 100%",
      phasePOptions,
    );
    expect(r[0].subCategory).toBe("Quick Policy");
    expect(r[0].workType).toBe("");
  });
});

// ---------------------------------------------------------------------
// Epic 1 — Robust whitespace normalization & consolidation
// ---------------------------------------------------------------------
// Daily logs differing only by internal spacing must consolidate into a
// single bucket instead of fracturing into multiple allocations.
describe("Epic 1 — whitespace normalization & consolidation", () => {
  it("collapses internal double-spaces so spacing variants share one bucket", () => {
    const entries = [
      { date: "2026-04-01", content: "- @AUII #Geniisys Support task" },
      // Same work, but with a doubled internal space — must NOT fracture.
      { date: "2026-04-02", content: "- @AUII #Geniisys  Support task" },
      { date: "2026-04-03", content: "- @AUII #Geniisys Support task" },
    ];
    const aggregated = aggregateJournalEntries(entries, {
      knownClients: KNOWN_CLIENTS,
    });
    // One (client, category) bucket, not three fractured ones.
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].client).toBe("AUII");
    expect(aggregated[0].pct).toBe(100);
    // The spacing-only variants dedupe to a single bullet.
    expect(aggregated[0].bullets).toHaveLength(1);
    // Stored bullet text is normalized (no double spaces).
    expect(aggregated[0].bullets[0]).not.toMatch(/ {2,}/);
  });

  it("dedupes across case + tag-order differences (user-reported case)", () => {
    // Four time-blocked entries, all '#Geniisys Support'. Two carry @AUII,
    // two don't. Cosmetic differences (double spaces, case, tag position)
    // must NOT create duplicate 'Support' / 'support' / 'SUpport' bullets.
    const entries = [
      { date: "2026-04-01", content: "9:00 am to 12:00 pm #Geniisys   Support" },
      { date: "2026-04-02", content: "1:00 pm to 6:00 pm #Geniisys  Support  @AUII" },
      { date: "2026-04-03", content: "9:00 am to 10:00 am SUpport #Geniisys" },
      { date: "2026-04-04", content: "11:00 am to 6:00 pm #Geniisys @AUII   support" },
    ];
    const aggregated = aggregateJournalEntries(entries, {
      knownClients: KNOWN_CLIENTS,
    });

    // Two buckets: AUII (explicit tag) and Internal (the two untagged lines).
    expect(aggregated).toHaveLength(2);

    // Every card collapses its Support variants to a SINGLE bullet.
    for (const item of aggregated) {
      expect(item.bullets).toHaveLength(1);
    }

    const auii = aggregated.find((a) => a.client === "AUII");
    expect(auii).toBeDefined();
    expect(auii!.category).toBe("Geniisys");
  });
});

// ---------------------------------------------------------------------
// Epic 2 — Specific Enhancement bypasses consolidation + routes to
// Projects → Geniisys → Specific Enhancement
// ---------------------------------------------------------------------
const specificEnhancementTaxonomy: TaxonomySnapshot = {
  subCategoryToMain: { Geniisys: "Projects" },
  defaultWorkTypeByParent: {
    Projects: "Development",
    Geniisys: "Implementation",
  },
  workTypesByParent: {
    Projects: ["Development", "Testing"],
    Geniisys: [
      "Implementation",
      "Enhancement",
      "Specific Enhancement",
      "Support",
      "Testing",
    ],
  },
};

const specificEnhancementOptions = {
  defaultTeam: "IT/Platforms",
  knownClients: ["AXA", "COCOGEN"],
  fallbackClient: "Internal",
  taxonomy: specificEnhancementTaxonomy,
};

describe("Epic 2 — Specific Enhancement isolation & routing", () => {
  it("each Specific Enhancement log gets its own card (never consolidated)", () => {
    const entries = [
      { date: "2026-04-01", content: "- #Geniisys Specific Enhancement @AXA Smart Claims" },
      { date: "2026-04-02", content: "- #Geniisys Specific Enhancement @COCOGEN Policy Renewal" },
      // A third, distinct SE item for the SAME client must still be its own card.
      { date: "2026-04-03", content: "- #Geniisys Specific Enhancement @AXA Motor Quote" },
    ];
    const aggregated = aggregateJournalEntries(entries, {
      knownClients: ["AXA", "COCOGEN"],
    });
    // Three isolated cards — no merging by client or category.
    expect(aggregated).toHaveLength(3);
    // All routed to the Geniisys sub-category.
    for (const item of aggregated) {
      expect(item.category).toBe("Geniisys");
    }
  });

  it("does NOT merge SE work into a general same-client block", () => {
    const entries = [
      { date: "2026-04-01", content: "- @AXA #Geniisys Support routine ticket" },
      { date: "2026-04-02", content: "- @AXA #Geniisys Specific Enhancement Smart Claims" },
    ];
    const aggregated = aggregateJournalEntries(entries, {
      knownClients: ["AXA", "COCOGEN"],
    });
    // The Support bucket and the isolated SE card stay separate → 2 buckets.
    expect(aggregated).toHaveLength(2);
    const seCard = aggregated.find((a) =>
      a.bullets.some((b) => /specific\s*enhancement/i.test(b)),
    );
    expect(seCard).toBeDefined();
  });

  it("parser routes a Specific Enhancement line to Geniisys / Specific Enhancement", () => {
    const result = parseWorkAllocation(
      "- @AXA #Geniisys Specific Enhancement Smart Claims - 100%",
      specificEnhancementOptions,
    );
    expect(result[0]).toMatchObject({
      workCategory: "Projects",
      subCategory: "Geniisys",
      workType: "Specific Enhancement",
      client: "AXA",
    });
  });

  it("glued 'SpecificEnhancement' (no space) still routes correctly", () => {
    const result = parseWorkAllocation(
      "- @COCOGEN #Geniisys SpecificEnhancement Renewal flow - 100%",
      specificEnhancementOptions,
    );
    expect(result[0].workType).toBe("Specific Enhancement");
    expect(result[0].client).toBe("COCOGEN");
  });

  it("round-trips: aggregation → prompt → parse preserves SE routing", () => {
    const entries = [
      { date: "2026-04-01", content: "- #Geniisys Specific Enhancement @AXA Smart Claims" },
    ];
    const aggregated = aggregateJournalEntries(entries, {
      knownClients: ["AXA", "COCOGEN"],
    });
    const promptText = formatAggregationAsPrompt(aggregated);
    const parsed = parseWorkAllocation(promptText, specificEnhancementOptions);
    expect(parsed[0]).toMatchObject({
      workCategory: "Projects",
      subCategory: "Geniisys",
      workType: "Specific Enhancement",
      client: "AXA",
    });
  });

  it("does not force SE when the phrase is absent (Epic 4 still governs)", () => {
    const result = parseWorkAllocation(
      "- @AXA #Geniisys unrelated maintenance work - 100%",
      specificEnhancementOptions,
    );
    expect(result[0].workType).not.toBe("Specific Enhancement");
  });
});

// ---------------------------------------------------------------------
// Epic 3 — multi-line block: header sets context, all bullets preserved
// ---------------------------------------------------------------------
describe("Epic 3 — multi-line parser preserves header context + all bullets", () => {
  it("keeps every child sub-task in the description (no swallowing)", () => {
    const input = [
      "#Geniisys Related Task for @AXA:",
      "-- using AWS ATHENA to get S3 bucket read and write logs",
      "-- Continua Axa GENIISYS Deployment",
      "-- Fix Cross Account AMI Backup - 100%",
    ].join("\n");
    const result = parseWorkAllocation(input, specificEnhancementOptions);
    expect(result).toHaveLength(1);
    // Header defines the base context mapping (not discarded).
    expect(result[0].workCategory).toBe("Projects");
    expect(result[0].subCategory).toBe("Geniisys");
    expect(result[0].client).toBe("AXA");
    // All three bullets survive in the description.
    expect(result[0].description).toContain("using AWS ATHENA");
    expect(result[0].description).toContain("Continua Axa GENIISYS Deployment");
    expect(result[0].description).toContain("Fix Cross Account AMI Backup");
  });

  it("keeps the header line as the leading description line (user-reported #Training Work)", () => {
    const input = [
      "#Training Work:",
      "-- & Development pilot testing",
      "-- & Development maintenance",
      "-- & Development clean up resources - 39.62%",
    ].join("\n");
    const result = parseWorkAllocation(input, phasePOptions);
    expect(result).toHaveLength(1);
    // The header "#Training Work" leads the description — not discarded, and
    // not replaced by the first bullet.
    const lines = result[0].description.split("\n");
    expect(lines[0]).toBe("#Training Work");
    expect(result[0].description).toContain("& Development pilot testing");
    expect(result[0].description).toContain("& Development clean up resources");
    expect(result[0].percentage).toBe(39.62);
  });
});

// ---------------------------------------------------------------------
// Scenario A fan-out — strict official-client filtering
// (excludes "(custom)" / unregistered artifacts; math divides by the
//  filtered count)
// ---------------------------------------------------------------------

describe("parseWorkAllocation — fan-out excludes custom clients", () => {
  // Geniisys sub-category under a "Projects" main. AUII/UCPB are in the
  // KNOWN_CLIENTS roster; the others are frontend artifacts that leaked into
  // the assignment list and must NOT spawn their own card.
  const fanOutOptions = {
    ...baseOptions,
    taxonomy: {
      subCategoryToMain: { Geniisys: "Projects" },
      defaultWorkTypeByParent: { Geniisys: "Implementation" },
      workTypesByParent: { Geniisys: ["Implementation"] },
      clientsBySubCategory: {
        Geniisys: ["AUII", "UCPB (custom)", "UCPB", "GhostCo"],
      },
    },
  };

  it("drops the '(custom)' artifact and the unregistered client, keeping only official clients", () => {
    const result = parseWorkAllocation(
      "- #Geniisys sprint work - 40%",
      fanOutOptions,
    );
    // Only AUII and UCPB survive → 2 cards, not 4.
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.client).sort()).toEqual(["AUII", "UCPB"]);
  });

  it("splits the percentage across the FILTERED count so the total still sums to the block %", () => {
    const result = parseWorkAllocation(
      "- #Geniisys sprint work - 40%",
      fanOutOptions,
    );
    // 40% / 2 official clients = 20% each (NOT 40/4 = 10%).
    for (const task of result) expect(task.percentage).toBe(20);
    const total = result.reduce((sum, t) => sum + t.percentage, 0);
    expect(total).toBe(40);
  });

  it("does not fan out at all when no client survives the filter", () => {
    const noOfficial = {
      ...baseOptions,
      taxonomy: {
        ...fanOutOptions.taxonomy,
        clientsBySubCategory: { Geniisys: ["GhostCo (custom)", "GhostCo"] },
      },
    };
    const result = parseWorkAllocation(
      "- #Geniisys sprint work - 40%",
      noOfficial,
    );
    // Falls through to a single non-fanned card at the full percentage.
    expect(result).toHaveLength(1);
    expect(result[0].percentage).toBe(40);
  });
});
