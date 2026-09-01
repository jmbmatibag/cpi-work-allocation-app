/**
 * Non-working-time strip at the wire→domain boundary.
 *
 * This is the single gate that makes leave invisible on EVERY allocation
 * surface (employee editor, TeamHub, dashboards, exports, analytics), so it
 * is worth pinning directly rather than through any one page.
 */
import { describe, it, expect } from "vitest";
import { stripNonWorkingStreams } from "../AllocationsContext";
import type { WorkStreamData } from "@/components/Workspace";

/** Minimal activity; only the taxonomy fields matter to the strip. */
function activity(
  overrides: Partial<WorkStreamData["activities"][number]> = {},
): WorkStreamData["activities"][number] {
  return {
    id: "a1",
    team: "Team A",
    workCategory: "Geniisys",
    subCategory: null,
    workType: "Enhancement",
    enhancementTag: null,
    client: "AUII",
    description: "SR 41631 payout screen",
    percentage: 100,
    ...overrides,
  } as WorkStreamData["activities"][number];
}

function stream(
  category: string,
  activities: WorkStreamData["activities"],
): WorkStreamData {
  return { category, activities, expanded: true };
}

describe("stripNonWorkingStreams", () => {
  it("removes leave activities but keeps real work in the same stream", () => {
    const result = stripNonWorkingStreams([
      stream("General Work", [
        activity({ id: "w", workCategory: "General Work", subCategory: "OTHERS", workType: "Administrative" }),
        activity({ id: "l", workCategory: "General Work", subCategory: "OTHERS", workType: "Sick Leave" }),
      ]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].activities.map((a) => a.id)).toEqual(["w"]);
  });

  it("drops a stream that contained only leave", () => {
    // An all-leave stream must not survive as an empty category header.
    const result = stripNonWorkingStreams([
      stream("General Work", [
        activity({ workCategory: "General Work", subCategory: "OTHERS", workType: "Holiday" }),
        activity({ id: "l2", workCategory: "General Work", subCategory: "OTHERS", workType: "Vacation Leave" }),
      ]),
      stream("Geniisys", [activity({ id: "keep" })]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("Geniisys");
  });

  it("returns an empty array when the whole month was leave", () => {
    const result = stripNonWorkingStreams([
      stream("General Work", [
        activity({ workCategory: "General Work", subCategory: "OTHERS", workType: "Maternity Leave" }),
      ]),
    ]);

    expect(result).toEqual([]);
  });

  it("matches leave work types case-insensitively", () => {
    const result = stripNonWorkingStreams([
      stream("General Work", [
        activity({ workType: "SABBATICAL LEAVE" }),
        activity({ id: "l2", workType: "  paternity leave  " }),
      ]),
    ]);

    expect(result).toEqual([]);
  });

  it("keeps every non-leave work type untouched", () => {
    const streams = [
      stream("Geniisys", [activity({ id: "a" }), activity({ id: "b", workType: "Support" })]),
      stream("IT", [activity({ id: "c", workCategory: "IT", workType: "Infrastructure" })]),
    ];

    // Same shape back out — no silent reordering or field loss.
    expect(stripNonWorkingStreams(streams)).toEqual(streams);
  });

  it("does not strip on description text alone", () => {
    // A project named "Holiday Promo" is real work. Post-classification the
    // gate reads the Work Type, never the free-text description.
    const result = stripNonWorkingStreams([
      stream("Projects", [
        activity({ workType: "Development", description: "Holiday Promo landing page" }),
      ]),
    ]);

    expect(result).toHaveLength(1);
  });
});
