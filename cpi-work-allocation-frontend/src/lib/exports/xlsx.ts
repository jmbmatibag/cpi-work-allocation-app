import ExcelJS from "exceljs";
import type { ExportColumn, ExportOptions, ExportRow } from "./types";
import { EXPORT_COLUMN_LABELS } from "./types";
import { LOGO_PNG_B64 } from "./logoBase64";

/**
 * XLSX writer via exceljs.
 *
 * Layout (matches PDF: logo left, title right, same row group):
 *   Rows 1-4  — logo image (A:B) | title / filters / timestamp (C:last)
 *   Row  5    — column headers (bold, indigo background, frozen)
 *   Row  6+   — data rows / team headers / employee sub-headers
 *
 * Row-type styling:
 *   team_header        — dark navy fill, white bold text, full-width merge
 *   employee_subheader — soft lavender fill, dark bold text, indented
 *   group_header       — light grey fill, dark bold text (employee grouping)
 *   data               — normal rows with faint bottom borders
 */
export async function exportToXlsx(
  options: ExportOptions,
  rows: readonly ExportRow[],
): Promise<Blob> {
  const { columns, scopeLabel, filtersSummary } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CPI Work Allocation";
  workbook.created = new Date();

  const sheetName = sanitizeSheetName(`Allocations ${scopeLabel}`);
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  const colCount = columns.length;
  // 3 compact rows (18pt each ≈ 54pt total) keep the logo small and
  // proportional — roughly matching the header block in the PDF.
  const ROW_H = 18;

  // ---- Rows 1-3: logo (A:B) + title / filters / timestamp (C:last) ----
  for (let i = 0; i < 3; i++) {
    const r = sheet.addRow(Array(colCount).fill(""));
    r.height = ROW_H;
  }

  const logoId = workbook.addImage({ base64: LOGO_PNG_B64, extension: "png" });
  // col:2 = start of column C = right edge of column B  |  row:3 = bottom of row 3
  sheet.addImage(logoId, {
    tl: { col: 0, row: 0 },
    br: { col: 1.8, row: 3 },
  });

  // Title/filters/timestamp to the right of the logo (same rows).
  const textStartCol = Math.min(3, colCount);

  const r1 = sheet.getRow(1);
  r1.getCell(textStartCol).value = `Allocations — ${scopeLabel}`;
  if (colCount > textStartCol) sheet.mergeCells(1, textStartCol, 1, colCount);
  r1.getCell(textStartCol).font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF1A2847" } };
  r1.getCell(textStartCol).alignment = { vertical: "bottom" };

  const r2 = sheet.getRow(2);
  r2.getCell(textStartCol).value = filtersSummary;
  if (colCount > textStartCol) sheet.mergeCells(2, textStartCol, 2, colCount);
  r2.getCell(textStartCol).font = { name: "Calibri", size: 10, color: { argb: "FF6B7280" } };
  r2.getCell(textStartCol).alignment = { vertical: "middle" };

  const r3 = sheet.getRow(3);
  r3.getCell(textStartCol).value = `Generated ${new Date().toLocaleString()}`;
  if (colCount > textStartCol) sheet.mergeCells(3, textStartCol, 3, colCount);
  r3.getCell(textStartCol).font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF9CA3AF" } };
  r3.getCell(textStartCol).alignment = { vertical: "top" };

  // ---- Row 4: column headers (frozen at ySplit: 4) ----
  const headerRow = sheet.addRow(columns.map((c) => EXPORT_COLUMN_LABELS[c]));
  headerRow.font = { bold: true, color: { argb: "FF1A2847" }, size: 11 };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
    cell.border = { bottom: { style: "medium", color: { argb: "FF4F46E5" } } };
    cell.alignment = { vertical: "middle" };
  });
  headerRow.height = 22;

  // ---- Row 6+: data / groups ----
  for (const row of rows) {
    if (row._kind === "data") {
      const values = columns.map((c) => {
        const v = row.cells[c];
        if (c === "percentage" && typeof v === "number") return v / 100;
        return v;
      });
      const dataRow = sheet.addRow(values);
      const pctIdx = columns.indexOf("percentage");
      if (pctIdx >= 0) {
        dataRow.getCell(pctIdx + 1).numFmt = "0.00%";
        dataRow.getCell(pctIdx + 1).alignment = { horizontal: "right" };
      }
      dataRow.eachCell((cell) => {
        cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      });
    } else if (row._kind === "team_header") {
      const label = `▸ Team: ${row.label}  ·  ${row.count} ${row.count === 1 ? "Activity" : "Activities"}`;
      const th = sheet.addRow([label]);
      sheet.mergeCells(th.number, 1, th.number, colCount);
      const cell = th.getCell(1);
      cell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A2847" } };
      cell.alignment = { vertical: "middle", indent: 1 };
      th.height = 24;
    } else if (row._kind === "employee_subheader") {
      const label = `    ▸ ${row.label}  ·  ${row.count} ${row.count === 1 ? "Activity" : "Activities"}  ·  ${row.total.toFixed(2)}%`;
      const eh = sheet.addRow([label]);
      sheet.mergeCells(eh.number, 1, eh.number, colCount);
      const cell = eh.getCell(1);
      cell.font = { bold: true, size: 11, color: { argb: "FF1A2847" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE3FF" } };
      cell.alignment = { vertical: "middle", indent: 2 };
      eh.height = 20;
    } else if (row._kind === "group_header") {
      const label = `▸ ${row.label}  ·  ${row.count} ${row.count === 1 ? "activity" : "activities"}  ·  ${row.total.toFixed(2)}%`;
      const gh = sheet.addRow([label]);
      sheet.mergeCells(gh.number, 1, gh.number, colCount);
      const cell = gh.getCell(1);
      cell.font = { bold: true, size: 11, color: { argb: "FF1A2847" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      cell.alignment = { vertical: "middle", indent: 1 };
      gh.height = 20;
    }
  }

  // ---- Column widths (auto-sized, capped) ----
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

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "").trim();
  return cleaned.slice(0, 31) || "Allocations";
}
