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
 * comment-ish rows at the top, then column headers, then data rows
 * with synthesized group-header rows rendered as a single merged
 * cell, then a grand total row.
 *
 * Escaping follows RFC 4180: values containing comma, quote, or
 * newline are wrapped in double quotes with internal quotes doubled.
 *
 * Kept free of library deps — raw string construction is < 50 lines
 * and handles every edge case we care about.
 */

export function exportToCsv(
  options: ExportOptions,
  rows: readonly ExportRow[],
): Blob {
  const { columns, scopeLabel, filtersSummary } = options;

  const lines: string[] = [];

  // Title block. CSV has no native concept of "metadata rows", so we
  // just emit extra rows at the top. Excel/Sheets import these as
  // data but users can easily ignore them, and they're essential
  // for knowing what a loose CSV on disk actually represents.
  lines.push(csvField(`Allocations — ${scopeLabel}`));
  lines.push(csvField(filtersSummary));
  lines.push(csvField(`Generated ${new Date().toLocaleString()}`));
  lines.push(""); // blank separator row

  // Column headers.
  lines.push(columns.map((c) => csvField(EXPORT_COLUMN_LABELS[c])).join(","));

  // Data / group / total rows.
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
      // Render as a single-cell row prefixed with ▸ so it's visually
      // distinct in Excel. Pad with empty cells so column count
      // matches.
      const header = `▸ ${row.label} (${row.count} ${
        row.count === 1 ? "activity" : "activities"
      }, ${row.total.toFixed(2)}%)`;
      const padded = [csvField(header), ...Array(columns.length - 1).fill("")];
      lines.push(padded.join(","));
    } else if (row._kind === "total") {
      // Total row: "Grand Total" in the employee-name column if
      // present, the count in the description column if present,
      // and the total percentage in the percentage column if present.
      const cells = columns.map((c) => {
        if (c === "employeeName" || c === "employeeId")
          return csvField(row.label);
        if (c === "description")
          return csvField(`${row.count} activities`);
        if (c === "percentage") return csvField(row.total.toFixed(2));
        return "";
      });
      // If neither name nor percentage is in the column list, fall
      // back to putting the label in the first cell.
      const hasLabel =
        columns.includes("employeeName") || columns.includes("employeeId");
      if (!hasLabel) cells[0] = csvField(row.label);
      lines.push(cells.join(","));
    }
  }

  return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
}

/**
 * RFC 4180 field escaping. Wrap in quotes if the value contains a
 * comma, double-quote, or newline; double internal quotes.
 */
function csvField(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
