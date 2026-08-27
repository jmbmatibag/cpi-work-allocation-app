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
 * placeholders in a CSV.
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
  /**
   * Resolved Enhancement value, already through the same
   * stored-tag -> description-parse -> blank chain the API's Finance CSV
   * uses. Resolved by the caller (which holds the live roster) so this
   * module stays free of taxonomy lookups.
   */
  enhancement: string;
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
 *   - "employee": activities grouped by employee. Each group preceded
 *     by a group_header row. Groups sorted by employee name ascending.
 *   - "team": two-level hierarchy — team_header → employee_subheader →
 *     data rows. Finance-spec format:
 *       Header 1:  [Team] — N Activities  (no percentage)
 *       Sub-Header: [Employee] — N Activities — X%
 *       Data rows: individual activity entries
 *
 * Grand Total rows are not emitted (removed per Finance spec).
 */
export function buildExportRows(
  sourceRows: readonly SourceRow[],
  grouping: ExportGrouping,
  columns: readonly ExportColumn[],
): ExportRow[] {
  const activities = sourceRows.filter(
    (r): r is SourceActivityRow => r.kind === "activity",
  );

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
        case "enhancement":  cells[col] = a.enhancement; break;
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
  } else if (grouping === "employee") {
    const buckets = new Map<string, SourceActivityRow[]>();
    for (const a of activities) {
      const k = `${a.employeeId}::${a.employeeName}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(a);
    }
    const sortedKeys = [...buckets.keys()].sort((a, b) => {
      return buckets.get(a)![0].employeeName.localeCompare(
        buckets.get(b)![0].employeeName,
      );
    });
    for (const key of sortedKeys) {
      const group = buckets.get(key)!;
      const total = round2(group.reduce((s, a) => s + a.percentage, 0));
      out.push({ _kind: "group_header", label: group[0].employeeName, total, count: group.length });
      for (const a of group) out.push(toDataRow(a));
    }
  } else {
    // "team" — two-level: team_header → employee_subheader → data rows
    const teamMap = new Map<string, Map<string, SourceActivityRow[]>>();
    for (const a of activities) {
      if (!teamMap.has(a.team)) teamMap.set(a.team, new Map());
      const empKey = `${a.employeeId}::${a.employeeName}`;
      const empMap = teamMap.get(a.team)!;
      if (!empMap.has(empKey)) empMap.set(empKey, []);
      empMap.get(empKey)!.push(a);
    }

    const sortedTeams = [...teamMap.keys()].sort((a, b) => a.localeCompare(b));
    for (const team of sortedTeams) {
      const empMap = teamMap.get(team)!;
      const teamCount = [...empMap.values()].reduce((s, arr) => s + arr.length, 0);
      out.push({ _kind: "team_header", label: team, count: teamCount });

      const sortedEmpKeys = [...empMap.keys()].sort((a, b) => {
        return empMap.get(a)![0].employeeName.localeCompare(
          empMap.get(b)![0].employeeName,
        );
      });
      for (const empKey of sortedEmpKeys) {
        const empActivities = empMap.get(empKey)!;
        const empTotal = round2(empActivities.reduce((s, a) => s + a.percentage, 0));
        out.push({
          _kind: "employee_subheader",
          label: empActivities[0].employeeName,
          count: empActivities.length,
          total: empTotal,
        });
        for (const a of empActivities) out.push(toDataRow(a));
      }
    }
  }

  return out;
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}
