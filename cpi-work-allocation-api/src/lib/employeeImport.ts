/**
 * Pre-flight analysis for the CPI employee-directory CSV import.
 *
 * Input is the raw CPI HR export (headers: No., Employee Number, Surname,
 * First Name, Middle Name, CPI Email, Assignment, Immediate Supervisor).
 *
 * This module is deliberately pure — rows in, structured analysis out. No
 * Prisma, no Express. The controller injects the current directory; this
 * file decides what WOULD happen on execute, without mutating anything:
 *
 *   - Validates required fields + email format
 *   - Maps CSV columns -> our User shape
 *   - Infers the Manager role: anyone named as someone's supervisor
 *   - Resolves supervisor names (fuzzy) against the directory + the batch
 *   - Reorders so inferred managers are created first (their reports can
 *     then resolve a real managerId in the execute phase)
 */
import type { UserRole } from 'cpi-work-allocation-shared';

export interface RawImportRow {
  'No.'?: string;
  'Employee Number'?: string;
  Surname?: string;
  'First Name'?: string;
  'Middle Name'?: string;
  'CPI Email'?: string;
  Assignment?: string;
  'Immediate Supervisor'?: string;
}

export interface DirectoryUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: UserRole[];
}

export type RowStatus = 'create' | 'skip_existing' | 'error';
export type SupervisorResolution =
  | 'existing' // matched a live directory user
  | 'in_batch' // matched another row in this CSV (created earlier in execute)
  | 'top_of_chain' // no supervisor / org-label (e.g. CPI-ExeCom)
  | 'not_found'; // named a person we can't find -> import without manager link

export interface MappedEmployee {
  firstName: string;
  lastName: string;
  middleName: string | null; // display-only; not persisted (no DB column)
  email: string;
  team: string;
  jobTitle: string;
  roles: UserRole[];
  isManager: boolean;
  supervisorName: string | null;
  supervisorKey: string | null;
  supervisorResolution: SupervisorResolution;
}

export interface AnalyzedRow {
  index: number; // 1-based data-row position in the source CSV
  raw: RawImportRow;
  status: RowStatus;
  mapped?: MappedEmployee;
  errors: string[]; // blocking — row is excluded from the create set
  warnings: string[]; // non-blocking — row still imports (e.g. missing supervisor)
}

export interface ImportAnalysis {
  summary: {
    totalRows: number;
    toCreate: number;
    alreadyExists: number;
    invalid: number;
    newManagers: number;
    missingSupervisors: number;
    emailsToSend: number;
  };
  /** Prioritized: inferred managers first, then other creates, then skips, then errors. */
  rows: AnalyzedRow[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Collapse a full name to a stable match key: first token + last token,
 * accent-stripped and lowercased. This is what makes
 *   "Eduardo James S. Distor" == "Eduardo James Distor" ==
 *   row(First="Eduardo James", Surname="Distor")
 * all resolve to "eduardo distor".
 *
 * Single-token input (e.g. an org label like "CPI-ExeCom") returns that one
 * token; the caller treats single-token supervisors as non-persons.
 */
export function nameKey(full: string): string {
  const cleaned = (full ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics: Peñaranda -> Penaranda
    .replace(/\./g, ' ')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length < 2) return tokens[0] ?? '';
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

export function analyzeImportRows(
  rawRows: RawImportRow[],
  directory: DirectoryUser[],
): ImportAnalysis {
  const cell = (r: RawImportRow, k: keyof RawImportRow) =>
    (r[k] ?? '').toString().trim();

  // --- directory lookups ---
  const dirByEmail = new Map<string, DirectoryUser>();
  const dirNameKeys = new Set<string>();
  for (const u of directory) {
    dirByEmail.set(u.email.toLowerCase(), u);
    const k = nameKey(`${u.firstName} ${u.lastName}`);
    if (k) dirNameKeys.add(k);
  }

  // --- pass A: shallow-map every row, compute name + supervisor keys ---
  const drafts = rawRows.map((raw, i) => {
    const firstName = cell(raw, 'First Name');
    const lastName = cell(raw, 'Surname');
    const team = cell(raw, 'Assignment') || 'Unassigned';
    const supervisorRaw = cell(raw, 'Immediate Supervisor') || null;

    // Take the first when several are listed: "A & B", "A and B".
    const firstSupervisor = supervisorRaw
      ? supervisorRaw.split(/\s*(?:&|\band\b)\s*/i)[0]!.trim()
      : '';
    const supKey = firstSupervisor ? nameKey(firstSupervisor) : '';
    // A real person has >= 2 name tokens AND isn't just the assignment label
    // echoed back (ExeCom rows list their org as "supervisor").
    const isPerson = !!supKey && supKey.includes(' ') && nameKey(team) !== supKey;

    return {
      index: i + 1,
      raw,
      firstName,
      lastName,
      middleName: cell(raw, 'Middle Name') || null,
      email: cell(raw, 'CPI Email'),
      team,
      selfKey: nameKey(`${firstName} ${lastName}`),
      supervisorRaw,
      supervisorKey: isPerson ? supKey : null,
    };
  });

  // Who is referenced as a supervisor anywhere? Those people become Managers.
  const referenced = new Set<string>();
  for (const d of drafts) if (d.supervisorKey) referenced.add(d.supervisorKey);
  // Every name in this batch — used to resolve in-batch supervisor links.
  const batchNameKeys = new Set(drafts.map((d) => d.selfKey).filter(Boolean));

  // --- pass B: validate, classify, map ---
  const seenEmails = new Set<string>();
  const missingSupervisorKeys = new Set<string>();
  const analyzed: AnalyzedRow[] = drafts.map((d) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!d.firstName || !d.lastName)
      errors.push('Missing name (First Name / Surname required).');
    const emailKey = d.email.toLowerCase();
    if (!d.email) errors.push('Missing Email.');
    else if (!EMAIL_RE.test(d.email)) errors.push(`Invalid Email ("${d.email}").`);
    else if (seenEmails.has(emailKey))
      errors.push(`Duplicate email in file ("${d.email}").`);
    if (d.email && EMAIL_RE.test(d.email)) seenEmails.add(emailKey);

    const isManager = !!d.selfKey && referenced.has(d.selfKey);
    const roles: UserRole[] = isManager ? ['Manager', 'Employee'] : ['Employee'];

    let supervisorResolution: SupervisorResolution = 'top_of_chain';
    if (d.supervisorKey) {
      if (dirNameKeys.has(d.supervisorKey)) supervisorResolution = 'existing';
      else if (batchNameKeys.has(d.supervisorKey)) supervisorResolution = 'in_batch';
      else {
        supervisorResolution = 'not_found';
        missingSupervisorKeys.add(d.supervisorKey);
        warnings.push(
          `Supervisor Not Found ("${d.supervisorRaw}") — will import without a manager link.`,
        );
      }
    }

    const exists = !!d.email && dirByEmail.has(emailKey);
    const status: RowStatus =
      errors.length > 0 ? 'error' : exists ? 'skip_existing' : 'create';

    const mapped: MappedEmployee | undefined =
      status === 'error'
        ? undefined
        : {
            firstName: d.firstName,
            lastName: d.lastName,
            middleName: d.middleName,
            email: d.email,
            team: d.team,
            jobTitle: isManager ? 'Manager' : 'Staff',
            roles,
            isManager,
            supervisorName: d.supervisorRaw,
            supervisorKey: d.supervisorKey,
            supervisorResolution,
          };

    return { index: d.index, raw: d.raw, status, mapped, errors, warnings };
  });

  // --- prioritize: managers first so reports can resolve managerId on execute ---
  const rank = (r: AnalyzedRow): number => {
    if (r.status === 'create' && r.mapped?.isManager) return 0;
    if (r.status === 'create') return 1;
    if (r.status === 'skip_existing') return 2;
    return 3;
  };
  const rows = analyzed
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i) // stable within rank
    .map((x) => x.r);

  const creates = rows.filter((r) => r.status === 'create');
  return {
    summary: {
      totalRows: rawRows.length,
      toCreate: creates.length,
      alreadyExists: rows.filter((r) => r.status === 'skip_existing').length,
      invalid: rows.filter((r) => r.status === 'error').length,
      newManagers: creates.filter((r) => r.mapped?.isManager).length,
      missingSupervisors: missingSupervisorKeys.size,
      emailsToSend: creates.length,
    },
    rows,
  };
}
