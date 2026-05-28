import ExcelJS from "exceljs";
import type { ExportColumn, ExportOptions, ExportRow } from "./types";
import { EXPORT_COLUMN_LABELS } from "./types";

/**
 * XLSX writer via exceljs.
 *
 * Produces one sheet with:
 *   - Title block (merged row, large bold font)
 *   - Filters summary (merged row, grey text)
 *   - Generated timestamp (merged row, grey text)
 *   - Column header row (bold, grey background, bottom border)
 *   - Data rows with group headers and grand total
 *   - Percentage column formatted as `0.00%`
 *   - Column widths auto-sized to content with sensible caps
 *
 * Kept within a single function to avoid over-abstraction; exceljs's
 * row/cell API is verbose but linear and easy to follow.
 */
export async function exportToXlsx(
  options: ExportOptions,
  rows: readonly ExportRow[],
): Promise<Blob> {
  const { columns, scopeLabel, filtersSummary } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CPI Work Allocation";
  workbook.created = new Date();

  // Sheet name can't contain certain chars; scopeLabel might. Fall
  // back to "Allocations" when the label is hostile.
  const sheetName = sanitizeSheetName(`Allocations ${scopeLabel}`);
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 5 }], // freeze through header row
  });

  const colCount = columns.length;

  // ---- Title block ----
  const titleRow = sheet.addRow([`Allocations — ${scopeLabel}`]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, colCount);
  titleRow.getCell(1).font = {
    name: "Calibri",
    size: 16,
    bold: true,
    color: { argb: "FF1A2847" },
  };
  titleRow.height = 28;

  const filtersRow = sheet.addRow([filtersSummary]);
  sheet.mergeCells(filtersRow.number, 1, filtersRow.number, colCount);
  filtersRow.getCell(1).font = {
    name: "Calibri",
    size: 10,
    color: { argb: "FF6B7280" },
  };

  const genRow = sheet.addRow([
    `Generated ${new Date().toLocaleString()}`,
  ]);
  sheet.mergeCells(genRow.number, 1, genRow.number, colCount);
  genRow.getCell(1).font = {
    name: "Calibri",
    size: 9,
    italic: true,
    color: { argb: "FF9CA3AF" },
  };

  // blank spacer row
  sheet.addRow([]);

  // ---- Column headers ----
  const headerRow = sheet.addRow(
    columns.map((c) => EXPORT_COLUMN_LABELS[c]),
  );
  headerRow.font = { bold: true, color: { argb: "FF1A2847" }, size: 11 };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEEF2FF" },
    };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF4F46E5" } },
    };
    cell.alignment = { vertical: "middle" };
  });
  headerRow.height = 22;

  // ---- Data / groups / total ----
  for (const row of rows) {
    if (row._kind === "data") {
      const values = columns.map((c) => {
        const v = row.cells[c];
        // Percentage stored as fraction so Excel's 0.00% format works.
        if (c === "percentage" && typeof v === "number") return v / 100;
        return v;
      });
      const dataRow = sheet.addRow(values);
      // Apply percentage format to that column if present.
      const pctIdx = columns.indexOf("percentage");
      if (pctIdx >= 0) {
        dataRow.getCell(pctIdx + 1).numFmt = "0.00%";
        dataRow.getCell(pctIdx + 1).alignment = { horizontal: "right" };
      }
      // Faint bottom border between rows for readability.
      dataRow.eachCell((cell) => {
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
      });
    } else if (row._kind === "group_header") {
      const label = `▸ ${row.label}  ·  ${row.count} ${
        row.count === 1 ? "activity" : "activities"
      }  ·  ${row.total.toFixed(2)}%`;
      const gh = sheet.addRow([label]);
      sheet.mergeCells(gh.number, 1, gh.number, colCount);
      const cell = gh.getCell(1);
      cell.font = { bold: true, size: 11, color: { argb: "FF1A2847" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
      cell.alignment = { vertical: "middle", indent: 1 };
      gh.height = 20;
    } else if (row._kind === "total") {
      const totalRow = sheet.addRow(
        columns.map((c) => {
          if (c === "employeeName" || c === "employeeId") return row.label;
          if (c === "description") return `${row.count} activities`;
          if (c === "percentage") return row.total / 100;
          return "";
        }),
      );
      totalRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FF1A2847" } };
        cell.border = {
          top: { style: "medium", color: { argb: "FF4F46E5" } },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF9FAFB" },
        };
      });
      const pctIdx = columns.indexOf("percentage");
      if (pctIdx >= 0) {
        totalRow.getCell(pctIdx + 1).numFmt = "0.00%";
        totalRow.getCell(pctIdx + 1).alignment = { horizontal: "right" };
      }
    }
  }

  // ---- Column widths ----
  //
  // Auto-size based on content length, capped at 48 so descriptions
  // don't blow the sheet out. Percentage/status narrow.
  columns.forEach((col, i) => {
    const header = EXPORT_COLUMN_LABELS[col];
    let maxLen = header.length;
    for (const row of rows) {
      if (row._kind !== "data") continue;
      const v = row.cells[col];
      const s = typeof v === "number" ? v.toFixed(2) : String(v ?? "");
      if (s.length > maxLen) maxLen = s.length;
    }
    const capped = Math.min(Math.max(maxLen + 2, 10), 48);
    sheet.getColumn(i + 1).width = capped;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Excel sheet names can't contain : \ / ? * [ ] and have a 31 char
 * hard limit. Strip the offenders and truncate.
 */
function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "").trim();
  return cleaned.slice(0, 31) || "Allocations";
}
