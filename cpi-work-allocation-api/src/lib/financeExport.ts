import { resolveEnhancementTag } from 'cpi-work-allocation-shared';

/**
 * Finance export mapping.
 *
 * Finance's sheet is a FLAT three-column taxonomy. Post-flatten our model
 * lines up almost 1:1, which is the whole point of the restructure:
 *
 *   Finance "Main Category" <- AllocationActivity.streamCategory   "Geniisys"
 *   Finance "Category 1"    <- AllocationActivity.workType         "Enhancement"
 *   Finance "Category 2"    <- workType + " - " + <work reference> "Enhancement - SR 41631"
 *
 * The work reference is NOT a stored column. Per the design decision to track
 * task detail in the Daily Journal rather than as hardcoded Work Types, it is
 * extracted from the activity description at export time.
 */

/** Ordered most-specific first — the first pattern to hit wins. */
const REFERENCE_PATTERNS: readonly RegExp[] = [
  // Service / change / work-order tickets: "SR 41631", "SR-41631", "CR#204".
  /\b(SR|CR|WO|TKT|INC|REQ|CHG)[\s#:_-]*(\d{2,})\b/i,
  // Hyphenated project keys: "JIRA-1420", "GEN-88". Before the plate pattern
  // so "ABC-1234" reads as a ticket key only when it is 2+ letters and the
  // plate shape below has already been given its chance.
  /\b([A-Z]{2,6}-\d{2,})\b/,
  // PH plate numbers: "ABC 1234", "ABC 123".
  /\b([A-Z]{3})\s(\d{3,4})\b/,
];

/**
 * Pull the task reference out of a free-text description.
 *
 * Returns null when nothing matches. Deliberately NOT a guessed fallback:
 * Column 2 gates Finance's own review, and a fabricated reference would pass
 * that review unchecked. A blank is visibly incomplete; a wrong SR number is
 * not.
 */
export function extractWorkReference(description: string): string | null {
  const text = (description ?? '').trim();
  if (!text) return null;

  for (const re of REFERENCE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    // Two capture groups = prefix + number, which we re-join with a single
    // space so "SR-41631" and "sr 41631" both normalise to "SR 41631".
    if (m.length >= 3 && m[2]) return `${m[1].toUpperCase()} ${m[2]}`;
    return m[1].toUpperCase();
  }
  return null;
}

// ── Enhancement tag ─────────────────────────────────────────────────────

/**
 * Resolution now lives in the shared package so this CSV and the frontend
 * Excel/PDF export cannot disagree about the same row. Re-exported here
 * because callers (and tests) already import them from this module.
 */
export { extractEnhancementTag } from 'cpi-work-allocation-shared';

/** Thin adapter: ActivitySource already satisfies EnhancementResolvable. */
export function resolveEnhancement(act: ActivitySource, roster: readonly string[]): string {
  return resolveEnhancementTag(act, roster);
}

export interface FinanceExportRow {
  mainCategory: string; // Finance Column 1
  category1: string; // Finance Column 2
  category2: string; // Finance Column 3
  // Structured Enhancement tag. Appended AFTER the three mandated columns,
  // same rule as the context columns below — Finance's column order is
  // theirs, and inserting into the middle of it silently breaks their sheet.
  enhancement: string;
  // Context columns. Finance asked for three, but a flat export with no owner
  // or period is unreconcilable against the source. Appended AFTER the
  // mandated three so their column order is untouched.
  employeeId: string;
  employeeName: string;
  team: string;
  client: string;
  percentage: number;
  period: string;
  status: string;
  description: string;
}

export interface ActivitySource {
  streamCategory: string;
  subCategory: string | null;
  workType: string;
  // Optional, not just nullable: rows read from a database migrated before
  // this column existed, and older test fixtures, legitimately omit it.
  enhancementTag?: string | null;
  client: string;
  description: string;
  percentage: number;
}

export interface RecordSource {
  employeeId: string;
  team: string;
  month: string;
  year: string;
  status: string;
  employee: { firstName: string; lastName: string };
  activities: readonly ActivitySource[];
}

/**
 * @param enhancementRoster live Enhancement names (settings snapshot / DB).
 *        Required so a stale or defaulted list can never silently produce a
 *        sheet that disagrees with what Finance sees in Admin Settings.
 */
export function buildFinanceRows(
  records: readonly RecordSource[],
  enhancementRoster: readonly string[],
): FinanceExportRow[] {
  const out: FinanceExportRow[] = [];

  for (const rec of records) {
    for (const act of rec.activities) {
      // Post-flatten `streamCategory` IS the project ("Geniisys"). The
      // subCategory arm is a transitional guard: run against a database where
      // flatten-projects.ts has not been applied, this still emits the
      // project name rather than the useless parent string "Projects".
      const mainCategory =
        act.subCategory && act.subCategory !== act.streamCategory
          ? act.subCategory
          : act.streamCategory;

      const reference = extractWorkReference(act.description);

      out.push({
        mainCategory,
        category1: act.workType,
        category2: reference ? `${act.workType} - ${reference}` : act.workType,
        enhancement: resolveEnhancement(act, enhancementRoster),
        employeeId: rec.employeeId,
        employeeName: `${rec.employee.firstName} ${rec.employee.lastName}`,
        team: rec.team,
        client: act.client,
        percentage: parseFloat(act.percentage.toFixed(2)),
        period: `${rec.month} ${rec.year}`,
        status: rec.status,
        description: act.description,
      });
    }
  }

  return out;
}

// ── CSV emission ────────────────────────────────────────────────────────────
// Hand-rolled rather than pulling papaparse into the API: this is one
// well-understood format and the dependency isn't worth it.

const CSV_COLUMNS: ReadonlyArray<[keyof FinanceExportRow, string]> = [
  ['mainCategory', 'Main Category'],
  ['category1', 'Category 1'],
  ['category2', 'Category 2'],
  ['enhancement', 'Enhancement'],
  ['employeeId', 'Employee ID'],
  ['employeeName', 'Employee Name'],
  ['team', 'Team'],
  ['client', 'Client'],
  ['percentage', '%'],
  ['period', 'Period'],
  ['status', 'Status'],
  ['description', 'Description'],
];

function csvCell(value: unknown): string {
  const s = String(value ?? '');
  // RFC 4180: quote when the value contains a delimiter, quote, or newline;
  // escape embedded quotes by doubling them.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toFinanceCsv(rows: readonly FinanceExportRow[]): string {
  const lines = [CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',')];
  for (const r of rows) {
    lines.push(CSV_COLUMNS.map(([key]) => csvCell(r[key])).join(','));
  }
  // \r\n per RFC 4180 — Excel on Windows is the consumer. The UTF-8 BOM is
  // prepended at the response layer, not baked into the string, so JSON
  // callers and tests get clean text.
  return lines.join('\r\n');
}
