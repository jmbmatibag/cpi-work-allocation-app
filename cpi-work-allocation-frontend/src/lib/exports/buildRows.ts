import type {
  ExportColumn,
  ExportGrouping,
  ExportRow,
} from "./types";

/**
 * Minimal subset of the MasterRow type from CompanyMasterOverview
 * that buildExportRows needs. Defining it here instead of importing
 * from the page keeps the export pipeline independent and testable.
 *
 * Empty-kind rows (employees with no submission for the period) are
 * filtered out of exports by default — Finance rarely wants "no data"
 * placeholders in a CSV. If we want them later, add a toggle.
 */
export interface SourceActivityRow {
  kind: "activity";
  employeeId: string;
  employeeName: string;
  team: string;
  managerName: string;
  status: string;
  workCategory: string;
  subCategory: string | null;
  workType: string;
  client: string;
  description: string;
  percentage: number;
}

export interface SourceEmptyRow {
  kind: "empty";
  employeeId: string;
  employeeName: string;
  team: string;
  managerName: string;
}

export type SourceRow = SourceActivityRow | SourceEmptyRow;

/**
 * Shape filtered MasterRows into the normalized ExportRow stream
 * that writers consume.
 *
 * Grouping behavior:
 *   - "flat": one data row per activity. No headers.
 *   - "employee": activities grouped by (employeeId, employeeName).
 *     Each group preceded by a group_header row. Groups sorted by
 *     employee name ascending.
 *   - "team": activities grouped by team. Same pattern.
 *
 * A single "total" row always closes the stream so writers can
 * emit the grand total without recalculating.
 */
export function buildExportRows(
  sourceRows: readonly SourceRow[],
  grouping: ExportGrouping,
  columns: readonly ExportColumn[],
): ExportRow[] {
  // Filter to activity rows — exports don't include "Not Submitted"
  // placeholders. Empty rows are a UI construct.
  const activities = sourceRows.filter(
    (r): r is SourceActivityRow => r.kind === "activity",
  );

  // Build a single data row from one activity, including only the
  // selected columns.
  const toDataRow = (a: SourceActivityRow): ExportRow => {
    const cells = {} as Record<ExportColumn, string | number>;
    for (const col of columns) {
      switch (col) {
        case "employeeId":   cells[col] = a.employeeId; break;
        case "employeeName": cells[col] = a.employeeName; break;
        case "team":         cells[col] = a.team; break;
        case "managerName":  cells[col] = a.managerName; break;
        case "status":       cells[col] = a.status; break;
        case "workCategory": cells[col] = a.workCategory; break;
        case "subCategory":  cells[col] = a.subCategory ?? ""; break;
        case "workType":     cells[col] = a.workType; break;
        case "client":       cells[col] = a.client; break;
        case "description":  cells[col] = a.description; break;
        case "percentage":   cells[col] = a.percentage; break;
      }
    }
    return { _kind: "data", cells };
  };

  const out: ExportRow[] = [];

  if (grouping === "flat") {
    for (const a of activities) out.push(toDataRow(a));
  } else {
    // Groupable key and display label per grouping mode.
    const keyFor = (a: SourceActivityRow): string =>
      grouping === "employee" ? `${a.employeeId}::${a.employeeName}` : a.team;
    const labelFor = (a: SourceActivityRow): string =>
      grouping === "employee" ? a.employeeName : `Team: ${a.team}`;

    // Preserve insertion order via Map; sort group keys after grouping.
    const buckets = new Map<string, SourceActivityRow[]>();
    for (const a of activities) {
      const k = keyFor(a);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(a);
    }

    // Sort group keys by display label for consistent output.
    const sortedKeys = [...buckets.keys()].sort((a, b) => {
      const ra = buckets.get(a)!;
      const rb = buckets.get(b)!;
      return labelFor(ra[0]).localeCompare(labelFor(rb[0]));
    });

    for (const key of sortedKeys) {
      const group = buckets.get(key)!;
      const total = group.reduce((s, a) => s + a.percentage, 0);
      out.push({
        _kind: "group_header",
        label: labelFor(group[0]),
        total: round2(total),
        count: group.length,
      });
      for (const a of group) out.push(toDataRow(a));
    }
  }

  // Grand total regardless of grouping.
  const grandTotal = activities.reduce((s, a) => s + a.percentage, 0);
  out.push({
    _kind: "total",
    label: "Grand Total",
    total: round2(grandTotal),
    count: activities.length,
  });

  return out;
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}
