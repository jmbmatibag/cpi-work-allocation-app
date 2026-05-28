/**
 * Shared types for the Finance export pipeline.
 *
 * Pipeline shape:
 *   CompanyMasterOverview (filtered rows, state)
 *      ↓
 *   ExportModal (user picks format + grouping + columns)
 *      ↓
 *   buildRows.ts (reshapes MasterRow[] → ExportRow[])
 *      ↓
 *   writers: csv.ts | xlsx.ts | pdf.ts (format-specific emission)
 *      ↓
 *   Blob download (browser Save dialog)
 *
 * Writers share the same input shape — ExportOptions + ExportRow[] —
 * so adding a new format is a single new writer module, no upstream
 * changes.
 */

export type ExportFormat = "csv" | "xlsx" | "pdf";

export type ExportGrouping = "flat" | "employee" | "team";

/**
 * Column keys map to fields on MasterRow. The modal presents them
 * as checkboxes; the user's selection survives one session (not
 * persisted) so subsequent exports in the same session remember
 * the last column set.
 */
export type ExportColumn =
  | "employeeId"
  | "employeeName"
  | "team"
  | "managerName"
  | "status"
  | "workCategory"
  | "subCategory"
  | "workType"
  | "client"
  | "description"
  | "percentage";

export const ALL_EXPORT_COLUMNS: readonly ExportColumn[] = [
  "employeeId",
  "employeeName",
  "team",
  "managerName",
  "status",
  "workCategory",
  "subCategory",
  "workType",
  "client",
  "description",
  "percentage",
];

/**
 * Display label per column. Used as the header in CSV/XLSX and the
 * table header in PDF. Kept near the type so adding a new column
 * means touching only one file.
 */
export const EXPORT_COLUMN_LABELS: Record<ExportColumn, string> = {
  employeeId: "Employee ID",
  employeeName: "Employee Name",
  team: "Team",
  managerName: "Manager",
  status: "Status",
  workCategory: "Category",
  subCategory: "Sub Category",
  workType: "Work Type",
  client: "Client",
  description: "Description",
  percentage: "%",
};

export interface ExportOptions {
  format: ExportFormat;
  grouping: ExportGrouping;
  columns: readonly ExportColumn[];
  /**
   * The scope string embedded in filenames and document titles.
   * Assembled by the caller from active filters, e.g.
   *   "Apr 2026"
   *   "Apr 2026 · IT/Platforms"
   *   "Apr 2026 · Carlos Garcia"
   * Writers use it to auto-generate the title at the top of the
   * output.
   */
  scopeLabel: string;
  /**
   * Machine-safe version of scopeLabel for the filename. Lowercase,
   * no spaces or special chars.
   *   "Apr 2026" -> "apr-2026"
   *   "Q1 2026 · IT/Platforms" -> "q1-2026-it-platforms"
   */
  scopeSlug: string;
  /**
   * Summary of active filters for display at the top of the output.
   * Rendered as a single line above the table. Example:
   *   "All teams · All managers · Approved only"
   */
  filtersSummary: string;
}

/**
 * Normalized row the writers consume. Already filtered to the
 * selected columns and ready to emit. Values are stringified except
 * for `percentage` which stays numeric so XLSX can format it as %.
 *
 * `_kind` discriminates data rows from the group-header rows we
 * synthesize for grouped exports. Writers skip percentage formatting
 * and status badges on header rows.
 */
export type ExportRow =
  | {
      _kind: "data";
      cells: Record<ExportColumn, string | number>;
    }
  | {
      _kind: "group_header";
      /** Label for the header — "Team: IT/Platforms" or employee name. */
      label: string;
      /** Total percentage for this group (sum of its data rows). */
      total: number;
      /** Count of data rows in this group. */
      count: number;
    }
  | {
      _kind: "total";
      /** Label like "Total" or "Grand Total". */
      label: string;
      /** Sum of percentages across all data rows. */
      total: number;
      /** Count of data rows. */
      count: number;
    };
