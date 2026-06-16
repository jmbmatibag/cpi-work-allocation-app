/**
 * Shared client-side types for the two-stage employee CSV import.
 * Mirrors cpi-work-allocation-api/src/lib/employeeImport.ts and the
 * SSE payloads emitted by employeesImport.ts::executeImport.
 *
 * Kept in /lib (not in the component) so both apiClient and the dialog
 * can reference one source of truth. Promote to cpi-work-allocation-shared
 * if/when the backend wants to import these too.
 */

export type RowStatus = "create" | "skip_existing" | "error";
export type SupervisorResolution =
  | "existing"
  | "in_batch"
  | "top_of_chain"
  | "not_found";

export interface MappedEmployee {
  firstName: string;
  lastName: string;
  middleName: string | null;
  email: string;
  team: string;
  jobTitle: string;
  roles: string[];
  isManager: boolean;
  supervisorName: string | null;
  supervisorKey: string | null;
  supervisorResolution: SupervisorResolution;
}

export interface AnalyzedRow {
  index: number;
  raw: Record<string, string>;
  status: RowStatus;
  mapped?: MappedEmployee;
  errors: string[];
  warnings: string[];
}

export interface ImportSummary {
  totalRows: number;
  toCreate: number;
  alreadyExists: number;
  invalid: number;
  newManagers: number;
  missingSupervisors: number;
  emailsToSend: number;
}

export interface ImportAnalysis {
  summary: ImportSummary;
  rows: AnalyzedRow[];
}

/** /analyze response: the analysis plus a one-time jobId for /execute. */
export interface AnalyzeResponse extends ImportAnalysis {
  jobId: string;
}

/** SSE `progress` event payload. */
export interface ExecuteProgress {
  phase: "create" | "link" | "email";
  processed: number;
  total: number;
  message: string;
}

/** SSE `complete` event payload. */
export interface ExecuteComplete {
  imported: number;
  linked: number;
  emailsSent: number;
  failed: { name: string; email: string; reason: string }[];
  skippedExisting: number;
  invalid: number;
  total: number;
}
