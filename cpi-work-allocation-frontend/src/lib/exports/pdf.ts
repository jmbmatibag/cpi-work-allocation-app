import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ExportOptions, ExportRow } from "./types";
import { EXPORT_COLUMN_LABELS, EXPORT_GROUPING_LABELS } from "./types";
import { LOGO_DATA_URI } from "./logoBase64";

/**
 * PDF writer via jsPDF + jspdf-autotable.
 *
 * jsPDF's built-in Helvetica is limited to Latin-1 / Windows-1252.
 * Characters outside that range (U+25B8 ▸, U+2014 —, U+2013 –)
 * render as garbage, so we sanitise them before writing any text.
 *
 * Design: landscape A4, modern / minimal.
 *   - Thin indigo accent stripe at the very top
 *   - Logo + title / filters / timestamp side-by-side in a compact header
 *   - Subtle rule separates header from table
 *   - Indigo column-header band, light slate alternating rows
 *   - Team rows: dark slate band, white bold text
 *   - Employee sub-rows: soft indigo tint, indigo-700 bold text
 *   - Page number in footer every page
 */
export async function exportToPdf(
  options: ExportOptions,
  rows: readonly ExportRow[],
): Promise<Blob> {
  const { columns, scopeLabel, filtersSummary, grouping } = options;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();  // 297mm
  const pageH = doc.internal.pageSize.getHeight(); // 210mm
  const ML = 14; // left / right margin

  // Capture once so continuation pages don't drift
  const generatedAt = new Date().toLocaleString();

  // ---- Helpers --------------------------------------------------------

  // Strip characters outside Latin-1 / Windows-1252 that Helvetica can't render.
  const safe = (s: string) =>
    s
      .replace(/[—–]/g, "-")   // em/en dash → hyphen
      .replace(/[▸►▶]/g, ">") // right-pointing triangles → >
      .replace(/•/g, "*");           // bullet → *

  const drawPageDecorations = (pageNum: number, isFirst: boolean) => {
    // Indigo accent stripe
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, pageW, 2.5, "F");

    if (isFirst) {
      // Logo
      doc.addImage(LOGO_DATA_URI, "PNG", ML, 6, 14, 14);

      const tx = ML + 18;

      // Title
      doc.setFontSize(17);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(safe(`Allocations - ${scopeLabel}`), tx, 14);

      // Filters
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(
        doc.splitTextToSize(
          safe(`${filtersSummary}  ·  ${EXPORT_GROUPING_LABELS[grouping]}`),
          pageW - tx - ML,
        ),
        tx, 20,
      );

      // Generated timestamp
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generated ${generatedAt}`, tx, 25.5);
    } else {
      // Continuation pages — minimal header
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(safe(`Allocations - ${scopeLabel}  (continued)`), ML, 10);
    }

    // Horizontal rule
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.35);
    doc.line(ML, isFirst ? 29 : 13, pageW - ML, isFirst ? 29 : 13);

    // Footer: page number right, brand name left
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${pageNum}`, pageW - ML, pageH - 4, { align: "right" });
    doc.text("CPI Work Allocation", ML, pageH - 4);
  };

  drawPageDecorations(1, true);

  // ---- Build table body -----------------------------------------------

  const colCount = columns.length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = [];

  for (const row of rows) {
    if (row._kind === "data") {
      body.push(
        columns.map((c) => {
          const v = row.cells[c];
          if (c === "percentage" && typeof v === "number") return `${v.toFixed(2)}%`;
          return safe(String(v ?? ""));
        }),
      );
    } else if (row._kind === "team_header") {
      const n = row.count;
      body.push([{
        content: `> Team: ${safe(row.label)}  ·  ${n} ${n === 1 ? "Activity" : "Activities"}`,
        colSpan: colCount,
        styles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 10,
          cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
        },
      }]);
    } else if (row._kind === "employee_subheader") {
      const n = row.count;
      body.push([{
        content: `    > ${safe(row.label)}  ·  ${n} ${n === 1 ? "Activity" : "Activities"}  ·  ${row.total.toFixed(2)}%`,
        colSpan: colCount,
        styles: {
          fillColor: [238, 242, 255],
          textColor: [55, 48, 163],
          fontStyle: "bold",
          fontSize: 9,
          cellPadding: { top: 2.5, bottom: 2.5, left: 10, right: 5 },
        },
      }]);
    } else if (row._kind === "group_header") {
      const n = row.count;
      body.push([{
        content: `> ${safe(row.label)}  ·  ${n} ${n === 1 ? "activity" : "activities"}  ·  ${row.total.toFixed(2)}%`,
        colSpan: colCount,
        styles: {
          fillColor: [241, 245, 249],
          textColor: [30, 41, 59],
          fontStyle: "bold",
          fontSize: 9,
        },
      }]);
    }
  }

  // Percentage column: right-align
  const pctIdx = columns.indexOf("percentage");
  const colStyles: Record<number, object> = {};
  if (pctIdx >= 0) colStyles[pctIdx] = { halign: "right" };

  autoTable(doc, {
    startY: 32,
    head: [columns.map((c) => EXPORT_COLUMN_LABELS[c])],
    body,
    theme: "plain",
    styles: {
      fontSize: 8,
      cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      textColor: [30, 41, 59],
      font: "helvetica",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [79, 70, 229],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      lineWidth: 0,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: colStyles,
    margin: { left: ML, right: ML, top: ML },
    tableWidth: pageW - ML * 2,
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawPageDecorations(data.pageNumber, false);
      }
    },
  });

  return doc.output("blob");
}
