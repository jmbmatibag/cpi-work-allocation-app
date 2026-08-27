import { describe, it, expect } from "vitest";
import { buildExportRows, type SourceActivityRow } from "../buildRows";
import { ALL_EXPORT_COLUMNS, EXPORT_COLUMN_LABELS } from "../types";

/**
 * The Excel/PDF/CSV export pipeline (lib/exports) is SEPARATE from the API's
 * flat Finance CSV (/api/finance-export). Both must carry the Enhancement
 * column, and both must resolve it identically — these tests pin the
 * frontend half.
 */

function activity(over: Partial<SourceActivityRow> = {}): SourceActivityRow {
  return {
    kind: "activity",
    employeeId: "ADM001",
    employeeName: "June Mark Matibag",
    team: "IT/Platforms",
    managerName: "Andrew Robes",
    status: "Pending Review",
    workCategory: "Geniisys",
    subCategory: null,
    workType: "Specific Enhancement",
    enhancement: "AXA-MTC",
    client: "AXA",
    description: "#Geniisys Specific Enhancement for @AXA",
    percentage: 100,
    ...over,
  };
}

describe("Enhancement column in the Excel/PDF export", () => {
  it("is registered in the column list and labelled", () => {
    expect(ALL_EXPORT_COLUMNS).toContain("enhancement");
    expect(EXPORT_COLUMN_LABELS.enhancement).toBe("Enhancement");
  });

  it("sits between Work Type and Client", () => {
    const i = ALL_EXPORT_COLUMNS.indexOf("enhancement");
    expect(ALL_EXPORT_COLUMNS[i - 1]).toBe("workType");
    expect(ALL_EXPORT_COLUMNS[i + 1]).toBe("client");
  });

  it("emits the resolved value into the data row", () => {
    const rows = buildExportRows([activity()], "flat", ALL_EXPORT_COLUMNS);
    const data = rows.filter((r) => r._kind === "data");
    expect(data).toHaveLength(1);
    expect(data[0].cells.enhancement).toBe("AXA-MTC");
  });

  it("emits blank rather than a guess when unresolved", () => {
    const rows = buildExportRows(
      [activity({ enhancement: "" })],
      "flat",
      ALL_EXPORT_COLUMNS,
    );
    const data = rows.filter((r) => r._kind === "data");
    expect(data[0].cells.enhancement).toBe("");
  });

  it("appears in the rendered header, next to Work Type", () => {
    // All three writers (xlsx / pdf / csv) build their header from this same
    // map, so asserting it here covers every output format at once.
    const header = ALL_EXPORT_COLUMNS.map((c) => EXPORT_COLUMN_LABELS[c]);
    expect(header).toContain("Enhancement");
    expect(header[header.indexOf("Enhancement") - 1]).toBe("Work Type");
    expect(header[header.indexOf("Enhancement") + 1]).toBe("Client");
  });

  it("is honoured when the user deselects it in the column picker", () => {
    const without = ALL_EXPORT_COLUMNS.filter((c) => c !== "enhancement");
    const rows = buildExportRows([activity()], "flat", without);
    const data = rows.filter((r) => r._kind === "data");
    expect(data[0].cells).not.toHaveProperty("enhancement");
  });
});
