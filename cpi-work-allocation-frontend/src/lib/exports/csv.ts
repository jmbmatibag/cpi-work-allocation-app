import type {
  ExportColumn,
  ExportOptions,
  ExportRow,
} from "./types";
import { EXPORT_COLUMN_LABELS } from "./types";

/**
 * CSV writer.
 *
 * Emits a title block (scope + filters + generated-at timestamp) as
 * comment-ish rows at the top, then column headers, then data rows.
 *
 * Grouping rows are rendered as single merged cells so they remain
 * readable when opened in Excel/Sheets.
 *
 * Escaping follows RFC 4180: values containing comma, quote, or
 * newline are wrapped in double quotes with internal quotes doubled.
 */

export function exportToCsv(
  options: ExportOptions,
  rows: readonly ExportRow[],
): Blob {
  const { columns, scopeLabel, filtersSummary } = options;

  const lines: string[] = [];

  lines.push(csvField(`Allocations — ${scopeLabel}`));
  lines.push(csvField(filtersSummary));
  lines.push(csvField(`Generated ${new Date().toLocaleString()}`));
  lines.push("");

  lines.push(columns.map((c) => csvField(EXPORT_COLUMN_LABELS[c])).join(","));

  for (const row of rows) {
    if (row._kind === "data") {
      lines.push(
        columns
          .map((c) => {
            const v = row.cells[c];
            if (c === "percentage" && typeof v === "number") {
              return csvField(v.toFixed(2));
            }
            return csvField(v);
          })
          .join(","),
      );
    } else if (row._kind === "group_header") {
      const header = `▸ ${row.label} (${row.count} ${
        row.count === 1 ? "activity" : "activities"
      }, ${row.total.toFixed(2)}%)`;
      const padded = [csvField(header), ...Array(columns.length - 1).fill("")];
      lines.push(padded.join(","));
    } else if (row._kind === "team_header") {
      const header = `▸ Team: ${row.label}  ·  ${row.count} ${row.count === 1 ? "Activity" : "Activities"}`;
      const padded = [csvField(header), ...Array(columns.length - 1).fill("")];
      lines.push(padded.join(","));
    } else if (row._kind === "employee_subheader") {
      const header = `    ▸ ${row.label}  ·  ${row.count} ${row.count === 1 ? "Activity" : "Activities"}  ·  ${row.total.toFixed(2)}%`;
      const padded = [csvField(header), ...Array(columns.length - 1).fill("")];
      lines.push(padded.join(","));
    }
  }

  return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
}

/**
 * RFC 4180 field escaping.
 */
function csvField(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
