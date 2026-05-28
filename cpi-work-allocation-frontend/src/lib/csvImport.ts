/**
 * CSV import for the employee directory.
 *
 * Two-phase pipeline:
 *   1. parseEmployeeCsv(text)      -> ParsedCsv (structural)
 *   2. validateRows(parsed, ctx)   -> ValidatedRow[] (semantic)
 *
 * Phase 1 failures (malformed file, missing headers) reject the
 * whole import.  Phase 2 failures are per-row and surface in the
 * preview so the user can import the good rows and fix the bad
 * ones separately.
 *
 * Deliberately no React, no context, no fetch — just text in,
 * structured rows out. Keeps the logic testable and swappable for
 * a server-side importer later.
 */

import type { Employee, EmployeeInput, UserRole } from "@/contexts/EmployeesContext";

// ---------------------------------------------------------------------
// CSV schema
// ---------------------------------------------------------------------

/**
 * Column order is irrelevant; we look up by header name. But the
 * set of required headers is fixed.
 *
 * The `roles` column accepts a semicolon-separated list for
 * multi-role users — e.g. "Admin;Manager;Employee". Single-role
 * values still work ("Employee" is one role). The header is named
 * `roles` (plural) to reflect this.
 */
export const CSV_HEADERS = [
  "firstName",
  "lastName",
  "email",
  "roles",
  "team",
  "jobTitle",
  "managerEmail",
  "password",
] as const;

export type CsvHeader = (typeof CSV_HEADERS)[number];

/**
 * A valid CSV template for export — used by the "Download Template"
 * button. Two example rows so the format is obvious without being
 * overwhelming.
 */
// The `roles` column is semicolon-separated for multi-role users. The
// second example shows a manager who also wears the employee hat.
export const CSV_TEMPLATE = [
  CSV_HEADERS.join(","),
  "Ana,Cruz,ana.cruz@example.com,Employee,IT/Platforms,Engineer,admin@cpi.com.ph,pass123",
  "Ben,Smith,ben.smith@example.com,Manager;Employee,Projects,Program Manager,,mgrpass",
].join("\n");

// All roles that can be assigned via CSV. Admin/Head are included so
// the importer matches the EmployeeManagement UI's full role list.
const VALID_ROLES: readonly UserRole[] = [
  "Employee",
  "Manager",
  "Finance",
  "Head",
  "Admin",
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse the `roles` CSV cell into a deduped UserRole array. Accepts
 * semicolon, comma (when inside the quoted cell), or pipe separators
 * for forgiveness — pick whichever your spreadsheet's auto-formatter
 * doesn't mangle. Returns null if the cell is empty.
 */
function parseRolesCell(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return Array.from(
    new Set(
      trimmed
        .split(/[;|]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

// ---------------------------------------------------------------------
// Phase 1 — parsing
// ---------------------------------------------------------------------

export interface ParsedCsv {
  /** Row data keyed by header, with string values as read from the file. */
  rows: Record<CsvHeader, string>[];
}

export type ParseError = {
  kind: "EMPTY_FILE" | "MISSING_HEADERS" | "MALFORMED";
  message: string;
};

export type ParseResult =
  | { ok: true; parsed: ParsedCsv }
  | { ok: false; error: ParseError };

/**
 * Split a single CSV line into fields, handling RFC 4180 quoting:
 *   - Fields may be enclosed in double quotes
 *   - Within a quoted field, "" represents a literal quote
 *   - Commas and newlines inside quoted fields are part of the field
 *
 * This handles quoted fields with commas inside. It does NOT handle
 * newlines inside quoted fields — for that we'd need a full
 * state-machine parser over the whole file. For the employee CSV
 * schema (short text fields, no multi-line descriptions) line-based
 * parsing is sufficient.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Look ahead for escaped quote.
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

export function parseEmployeeCsv(raw: string): ParseResult {
  // Strip BOM (Excel / Windows Notepad save CSVs with \uFEFF prefix)
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) {
    return {
      ok: false,
      error: { kind: "EMPTY_FILE", message: "The CSV file is empty." },
    };
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      ok: false,
      error: {
        kind: "EMPTY_FILE",
        message:
          "The CSV needs a header row and at least one data row.",
      },
    };
  }

  const headerCells = splitCsvLine(lines[0]).map((h) => h.trim());
  const missing = CSV_HEADERS.filter((h) => !headerCells.includes(h));
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        kind: "MISSING_HEADERS",
        message:
          `Missing required ${missing.length === 1 ? "header" : "headers"}: ` +
          missing.join(", ") +
          `. Expected headers: ${CSV_HEADERS.join(", ")}.`,
      },
    };
  }

  const rows: Record<CsvHeader, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {} as Record<CsvHeader, string>;
    for (const h of CSV_HEADERS) {
      const idx = headerCells.indexOf(h);
      row[h] = (cells[idx] ?? "").trim();
    }
    rows.push(row);
  }

  return { ok: true, parsed: { rows } };
}

// ---------------------------------------------------------------------
// Phase 2 — validation
// ---------------------------------------------------------------------

export type RowErrorKind =
  | "MISSING_FIELD"
  | "INVALID_EMAIL"
  | "INVALID_ROLE"
  | "UNKNOWN_TEAM"
  | "MANAGER_NOT_FOUND"
  | "MANAGER_NOT_A_MANAGER"
  | "DUPLICATE_IN_BATCH"
  | "EMAIL_EXISTS";

export interface RowError {
  kind: RowErrorKind;
  message: string;
}

export interface ValidatedRow {
  /** Zero-indexed original CSV row number (excludes the header). */
  index: number;
  raw: Record<CsvHeader, string>;
  /**
   * Partial input — EVERYTHING except managerId, which the UI
   * resolves at import time by looking up `managerEmail` against
   * the live directory. Deferring this lets a CSV create a manager
   * and their reports in one pass: by the time the report is
   * inserted, the manager has an id.
   */
  input?: Omit<EmployeeInput, "managerId"> & { managerEmail: string | null };
  errors: RowError[];
}

export interface ValidationContext {
  /** The existing directory — used for email-exists + manager-lookup. */
  existingEmployees: readonly Employee[];
  /** Valid team names. Strict match — unknown teams fail. */
  validTeams: readonly string[];
}

const normalizeEmail = (e: string) => e.trim().toLowerCase();

/**
 * Validate parsed rows against the current directory + taxonomy.
 * Rows are evaluated independently; a bad row doesn't poison the
 * rest of the batch.
 *
 * Two-pass manager resolution (see `buildManagerLookup` below) so
 * a CSV that includes both a new manager and their reports imports
 * cleanly in one go.
 */
export function validateRows(
  parsed: ParsedCsv,
  ctx: ValidationContext,
): ValidatedRow[] {
  // Build a lookup of Manager-role users that WILL exist after this
  // import — the current Manager directory plus any rows in this
  // batch declaring role=Manager. This is what lets a CSV include a
  // manager and their reports in any order.
  const managerEmailToId = buildManagerLookup(parsed, ctx);

  // Track emails seen in this batch to catch within-batch duplicates.
  const batchEmails = new Set<string>();
  const existingEmails = new Set(
    ctx.existingEmployees.map((e) => normalizeEmail(e.email)),
  );

  const results: ValidatedRow[] = [];

  parsed.rows.forEach((row, i) => {
    const errors: RowError[] = [];
    const record: ValidatedRow = { index: i, raw: row, errors };

    // Required fields.
    for (const field of ["firstName", "lastName", "email", "roles", "team", "jobTitle", "password"] as const) {
      if (!row[field]) {
        errors.push({
          kind: "MISSING_FIELD",
          message: `Missing "${field}".`,
        });
      }
    }

    // Email format.
    if (row.email && !EMAIL_RE.test(row.email)) {
      errors.push({
        kind: "INVALID_EMAIL",
        message: `"${row.email}" is not a valid email.`,
      });
    }

    // Roles. Semicolon-separated list. Each token must be in the valid
    // role enum; an unknown role fails the whole row (rather than
    // silently dropping the bad token).
    const parsedRoles = parseRolesCell(row.roles);
    if (parsedRoles.length === 0 && row.roles) {
      // Cell had content but parsed to nothing — probably whitespace
      // only after the separator split.
      errors.push({
        kind: "INVALID_ROLE",
        message: `Roles cell "${row.roles}" couldn't be parsed.`,
      });
    } else {
      for (const r of parsedRoles) {
        if (!(VALID_ROLES as readonly string[]).includes(r)) {
          errors.push({
            kind: "INVALID_ROLE",
            message: `Unknown role "${r}". Allowed: ${VALID_ROLES.join(", ")}.`,
          });
        }
      }
    }

    // Team.
    if (row.team && !ctx.validTeams.includes(row.team)) {
      errors.push({
        kind: "UNKNOWN_TEAM",
        message:
          `Team "${row.team}" is not in the configured teams. ` +
          `Either fix the CSV or add this team in Settings first.`,
      });
    }

    // Batch duplicate — within this single file, same email twice.
    if (row.email) {
      const key = normalizeEmail(row.email);
      if (batchEmails.has(key)) {
        errors.push({
          kind: "DUPLICATE_IN_BATCH",
          message: `Email "${row.email}" appears more than once in this CSV.`,
        });
      }
      batchEmails.add(key);

      // Already in directory.
      if (existingEmails.has(key)) {
        errors.push({
          kind: "EMAIL_EXISTS",
          message: `Email "${row.email}" is already in the directory.`,
        });
      }
    }

    // managerEmail resolution. Empty is fine (top-of-chain).
    // We only check RESOLVABILITY here — the actual managerId lookup
    // happens at import time so managers created earlier in this
    // batch are visible.
    let managerEmail: string | null = null;
    if (row.managerEmail) {
      const lookupKey = normalizeEmail(row.managerEmail);
      const resolved = managerEmailToId.get(lookupKey);
      if (!resolved) {
        errors.push({
          kind: "MANAGER_NOT_FOUND",
          message:
            `Manager email "${row.managerEmail}" doesn't match any ` +
            `existing manager, and no row in this CSV is creating one.`,
        });
      } else if (resolved.kind === "existing_not_manager") {
        errors.push({
          kind: "MANAGER_NOT_A_MANAGER",
          message:
            `"${row.managerEmail}" exists but is not a Manager. ` +
            `Only Manager-role users can be assigned as managers.`,
        });
      } else {
        managerEmail = row.managerEmail;
      }
    }

    if (errors.length === 0) {
      record.input = {
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        password: row.password,
        roles: parsedRoles as UserRole[],
        team: row.team,
        jobTitle: row.jobTitle,
        managerEmail,
      };
    }

    results.push(record);
  });

  return results;
}

/**
 * Builds a lookup from normalized manager email -> resolved id.
 *
 * Resolution sources, in precedence order:
 *   1. Existing Manager-role users in the directory
 *   2. Existing non-Manager users (returned tagged so we can
 *      surface a specific error — "Patricia exists but is Finance")
 *   3. New Manager-role rows in this CSV batch (id is null because
 *      they haven't been created yet; the importer will resolve
 *      post-insert via email)
 *
 * Returning "pending_in_batch" with id=null is a deliberate marker:
 * the import logic loops rows post-add and resolves `managerId` for
 * reports whose manager was a pending row.
 */
function buildManagerLookup(
  parsed: ParsedCsv,
  ctx: ValidationContext,
): Map<
  string,
  | { kind: "existing_manager"; id: string }
  | { kind: "existing_not_manager" }
  | { kind: "pending_in_batch"; id: null }
> {
  const map = new Map<
    string,
    | { kind: "existing_manager"; id: string }
    | { kind: "existing_not_manager" }
    | { kind: "pending_in_batch"; id: null }
  >();

  for (const e of ctx.existingEmployees) {
    const key = normalizeEmail(e.email);
    if (e.roles.includes("Manager")) {
      map.set(key, { kind: "existing_manager", id: e.id });
    } else {
      map.set(key, { kind: "existing_not_manager" });
    }
  }

  for (const row of parsed.rows) {
    if (!row.email) continue;
    const rowRoles = parseRolesCell(row.roles);
    if (rowRoles.includes("Manager")) {
      const key = normalizeEmail(row.email);
      // A batch row for a new manager wins over an existing
      // non-manager entry only — doesn't override an already-known
      // manager in the directory.
      if (!map.has(key)) {
        map.set(key, { kind: "pending_in_batch", id: null });
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------
// Import execution — ordering helper
// ---------------------------------------------------------------------

/**
 * Sort validated rows so managers come before their reports. Used
 * by the UI to call addEmployee in an order that lets the directory
 * context resolve managerId references as we go.
 *
 * Two-pass approach: Manager rows first (in original order), then
 * everyone else (in original order). Stable sort preserves intra-
 * group order.
 */
export function orderForImport(rows: ValidatedRow[]): ValidatedRow[] {
  const managers: ValidatedRow[] = [];
  const others: ValidatedRow[] = [];
  for (const r of rows) {
    if (r.input?.roles.includes("Manager")) managers.push(r);
    else others.push(r);
  }
  return [...managers, ...others];
}
