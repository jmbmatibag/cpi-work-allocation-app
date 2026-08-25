/**
 * apiClient — typed fetch wrapper for the CPI Work Allocation API.
 *
 * Every request uses credentials:'include' so the browser sends the
 * HttpOnly auth_token + refresh_token cookies automatically.
 *
 * 401 handling: on any 401 the client tries POST /api/auth/refresh once.
 * If the refresh succeeds, the original request is retried.
 * If the refresh also fails (both tokens expired / revoked), the browser
 * is redirected to /login so the user can re-authenticate.
 *
 * Usage:
 *   import { api } from '@/lib/apiClient';
 *   const user = await api.auth.me();
 */

import type { UserRole } from 'cpi-work-allocation-shared';
import type { AnalyzeResponse } from './employeeImportTypes';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// Exposed so EventSource (which can't go through the fetch wrapper) can build
// an absolute URL to the SSE import-execute endpoint.
export const API_BASE = BASE;

// ---------------------------------------------------------------------------
// Core types (match the shapes that the API controllers return)
// ---------------------------------------------------------------------------

export interface ApiUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  // Multi-role: a user can carry any subset of the role enum. Permissions
  // are the UNION of the listed roles. Use `primaryRole(roles)` (from
  // cpi-work-allocation-shared) when one canonical role is needed.
  roles: UserRole[];
  team: string;
  managerId: string | null;
  jobTitle: string;
  // When true, the user is excluded from automated scheduled reminder emails.
  emailNotificationsExempt: boolean;
}

export interface ApiActivityFlag {
  reason: string;
  flaggedAt: string;
}

export interface ApiActivity {
  id: string;
  team: string;
  workCategory: string;
  subCategory: string | null;
  workType: string;
  client: string;
  description: string;
  percentage: number;
  expanded?: boolean;
}

export interface ApiWorkStream {
  category: string;
  activities: ApiActivity[];
  expanded?: boolean;
}

export interface ApiAllocationRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  team: string;
  managerId: string;
  managerName: string;
  month: string;
  year: string;
  monthIndex: number;
  streams: ApiWorkStream[];
  status: 'Draft' | 'PendingReview' | 'Approved' | 'NeedsRevision';
  submittedAt?: string;
  reviewedAt?: string;
  feedback?: string;
  flags?: Record<string, ApiActivityFlag>;
  lastEditedBy?: { userId: string; userName: string; at: string };
  // Peer Coverage accountability — who actually approved/returned this
  // record. The verb ("Approved by" / "Returned by") is derived from status.
  actionedBy?: { userId: string; userName: string; at: string };
}

// One event in an allocation's lifecycle timeline (read-only). Sourced from
// the server-side AuditLog — see GET /api/allocations/:id/history.
export interface ApiAllocationHistoryEvent {
  id: number;
  // Stable, UI-facing category the timeline renders an icon/tone for.
  eventType: 'SUBMITTED' | 'APPROVED' | 'REVISION_REQUESTED' | 'EDITED';
  // Raw audit action ('submit' | 'approve' | 'return' | 'manager-edit').
  action: string;
  // The person who took the action. Null only for legacy/system rows whose
  // actor was later deleted (AuditLog.userId is SetNull on user delete).
  actor: { id: string; name: string } | null;
  // Free-text comment left with the action (revision feedback). Null otherwise.
  comment: string | null;
  // Per-card flags captured on a REVISION_REQUESTED event — which specific
  // cards the manager flagged and the reason left on each. Empty for every
  // other event type (and for returns predating flag-capture in the payload).
  flags?: Array<{ card: string; comment: string }>;
  createdAt: string;
}

// A peer manager — element of the eligible-peers list and the pinned tabs.
export interface ApiPeerManager {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
  jobTitle: string;
}

export interface ApiJournalEntry {
  employeeId: string;
  date: string;
  content: string;
  blocks?: Array<{ id: string; startTime: string; endTime: string; description: string }>;
  updatedAt: string;
}

export interface ApiSettingsSnapshot {
  teams: Array<{ id: number; name: string; sortOrder: number }>;
  clients: Array<{ id: number; name: string; sortOrder: number }>;
  mainCategories: Array<{
    id: number;
    name: string;
    sortOrder: number;
    /** Roster for sub-less mains (flattened projects). Empty array otherwise. */
    clients: string[];
  }>;
  subCategories: Array<{
    id: number;
    name: string;
    parentMainCategory: string;
    mainCategoryId: number;
    clients: string[];
    sortOrder: number;
  }>;
  workTypes: Array<{ id: number; name: string; parents: string[] }>;
  inferenceRules: Array<{
    id: number;
    keywords: string[];
    category: string;
    subCategory: string | null;
    workType: string;
    sortOrder: number;
  }>;
}

export interface ApiGeneratedRule {
  id: number;
  keywords: string[];
  category: string;
  subCategory: string | null;
  workType: string;
  sortOrder: number;
}

export interface ApiSubCategoryClientsResult {
  subCategory: { id: number; name: string };
  generatedRules: ApiGeneratedRule[];
}

export interface ApiWorkTypeParentsResult {
  workType: { id: number; name: string };
  generatedRules: ApiGeneratedRule[];
}

// ---------------------------------------------------------------------------
// Low-level fetch machinery
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}: ${JSON.stringify(body)}`);
  }
}

export { ApiError };

// localStorage keys that must survive a session-expiry wipe. The theme
// choice is a device-level UI preference, not session state — clearing it
// on logout/expiry is what made dark mode "reset on reload" across sessions
// (Epic 4). Add any other device-scoped preferences here.
const PRESERVED_LOCAL_STORAGE_KEYS = ['cpi-theme'];

/**
 * Clear localStorage on session expiry without nuking device-level UI
 * preferences (e.g. the persisted theme). Snapshots the preserved keys,
 * clears everything, then restores them.
 */
function clearLocalStoragePreservingTheme(): void {
  const preserved: Record<string, string> = {};
  for (const key of PRESERVED_LOCAL_STORAGE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) preserved[key] = value;
  }
  localStorage.clear();
  for (const [key, value] of Object.entries(preserved)) {
    localStorage.setItem(key, value);
  }
}

/**
 * Mirror of the server-owned maintenance switch, kept current by
 * useMaintenanceStatus. Module-level because the 401 handler below is plain
 * async code with no access to React state.
 *
 * While maintenance is on, a 401 must NOT wipe localStorage or fire the
 * session-expired modal: a signed-out visitor sitting on the announcement
 * would otherwise get a blocking "Sign In Again" dialog over it and be
 * bounced to /login — straight past the notice they're meant to read.
 */
let maintenanceActive = false;

export function setMaintenanceActive(active: boolean): void {
  maintenanceActive = active;
}

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;
  isRefreshing = true;
  refreshPromise = fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });
  return refreshPromise;
}

const REQUEST_TIMEOUT_MS = 30_000;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  // Wire a 30s timeout into the outgoing AbortSignal. Compose with any
  // React-Query-supplied signal so caller cancellation still works.
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), REQUEST_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutCtrl.signal])
    : timeoutCtrl.signal;

  const opts: RequestInit = {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    signal: combinedSignal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, opts);
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401) {
    // /api/auth/refresh itself must never recurse through tryRefresh —
    // that would loop forever when the refresh token is itself expired.
    const isRefreshCall = path === '/api/auth/refresh';
    // Credential endpoints return 401 to mean "wrong password", not "session
    // expired". Skip refresh + redirect so the component's catch block gets
    // the real server error body instead of a spurious session-expired logout.
    const isCredentialCheck =
      path === '/api/auth/login' || path === '/api/auth/change-password';

    if (!isCredentialCheck) {
      const refreshed = !isRefreshCall && (await tryRefresh());
      if (refreshed) {
        res = await fetch(`${BASE}${path}`, opts);
      }
      // If the retry STILL returns 401 (user deleted mid-flight, race with
      // a sibling-tab logout), or refresh failed outright — redirect.
      // Do NOT redirect when the user is already on a public page that is
      // legitimately accessible without a session (setup-password and
      // reset-password tokens arrive via email to unauthenticated users).
      if (res.status === 401) {
        const PUBLIC_PATHS = ['/login', '/setup-password', '/reset-password', '/maintenance'];
        if (!maintenanceActive && !PUBLIC_PATHS.includes(window.location.pathname)) {
          clearLocalStoragePreservingTheme();
          // Fire a DOM event so the SessionExpiredModal can show a message
          // before the redirect happens. The modal owns the navigation.
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
        throw new ApiError(401, { error: 'Session expired' });
      }
    }
  }

  if (!res.ok) {
    let errorBody: unknown;
    try { errorBody = await res.json(); } catch { errorBody = null; }
    throw new ApiError(res.status, errorBody);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

const get  = <T>(path: string, signal?: AbortSignal) => request<T>('GET',    path, undefined, signal);
const post = <T>(path: string, body?: unknown)        => request<T>('POST',   path, body);
const put  = <T>(path: string, body?: unknown)        => request<T>('PUT',    path, body);
const patch= <T>(path: string, body?: unknown)        => request<T>('PATCH',  path, body);
const del  = <T>(path: string)                        => request<T>('DELETE', path);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const auth = {
  // Step 1 of two-step sign-in: verifies password, triggers OTP email.
  // Replaces the old `requestOtp(email)` call from the OTP-only era.
  login: (email: string, password: string) =>
    post<{ message: string }>('/api/auth/login', { email, password }),

  // Step 2: exchanges the OTP for an authenticated session. `rememberMe`
  // (Epic 2) controls the session length — 7 days when true, the strict 10
  // hours when false — and is decided by the checkbox on the login screen.
  verifyOtp: (email: string, code: string, rememberMe = false) =>
    post<{ user: ApiUser }>('/api/auth/verify-otp', { email, code, rememberMe }),

  // Re-issues a fresh login OTP during an in-progress sign-in. Rejects with
  // 429 (ApiError) once the per-user resend cap / hourly lockout is hit.
  resendOtp: (email: string) =>
    post<{ message: string }>('/api/auth/resend-otp', { email }),

  // One-time redemption of the welcome-email setup link.
  setupPassword: (token: string, password: string) =>
    post<{ message: string }>('/api/auth/setup-password', { token, password }),

  // Initiates the forgot-password flow. Always resolves (200) so callers
  // cannot distinguish registered vs. unregistered emails.
  forgotPassword: (email: string) =>
    post<{ message: string }>('/api/auth/forgot-password', { email }),

  // Redeems a one-time reset link from the forgot-password email.
  resetPassword: (token: string, password: string) =>
    post<{ message: string }>('/api/auth/reset-password', { token, password }),

  // Changes the logged-in user's password. Requires the current password.
  // On success the backend clears all sessions and returns sessionExpired:true —
  // the caller must clear local state and redirect to /login.
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ message: string; sessionExpired: true }>('/api/auth/change-password', { currentPassword, newPassword }),

  me: (signal?: AbortSignal) =>
    get<{ user: ApiUser }>('/api/auth/me', signal),

  refresh: () =>
    post<{ ok: boolean }>('/api/auth/refresh'),

  logout: () =>
    post<{ message: string }>('/api/auth/logout'),

  logoutAll: () =>
    post<{ message: string; revoked: number }>('/api/auth/logout-all'),
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

const employees = {
  list: (signal?: AbortSignal) =>
    get<ApiUser[]>('/api/employees', signal),

  getOne: (id: string) =>
    get<ApiUser>(`/api/employees/${encodeURIComponent(id)}`),

  create: (body: {
    id?: string;
    firstName: string;
    lastName: string;
    email: string;
    // Optional: backend auto-generates a random hash when omitted or
    // empty. Auth is OTP-only, so this column is a placeholder.
    password?: string;
    roles: UserRole[];
    team: string;
    managerId?: string | null;
    jobTitle: string;
    emailNotificationsExempt?: boolean;
  }) => post<ApiUser>('/api/employees', body),

  update: (id: string, patch: {
    firstName?: string;
    lastName?: string;
    email?: string;
    password?: string;
    roles?: UserRole[];
    team?: string;
    managerId?: string | null;
    jobTitle?: string;
    emailNotificationsExempt?: boolean;
  }) => put<ApiUser>(`/api/employees/${encodeURIComponent(id)}`, patch),

  remove: (id: string) =>
    del<void>(`/api/employees/${encodeURIComponent(id)}`),

  bulkDelete: (ids: string[]) =>
    post<{ deleted: string[]; skipped: { id: string; reason: string }[] }>(
      '/api/employees/bulk-delete',
      { ids },
    ),

  bulkResendWelcome: (ids: string[]) =>
    post<{ sent: string[]; skipped: { id: string; reason: string }[] }>(
      '/api/employees/bulk-resend-welcome',
      { ids },
    ),

  // CSV import, stage 1: pre-flight analysis. Returns a one-time jobId +
  // the prioritized plan. Creates nothing.
  analyzeImport: (rows: Record<string, string>[]) =>
    post<AnalyzeResponse>('/api/employees/import/analyze', { rows }),

  // CSV import, stage 2: absolute SSE URL for EventSource. The browser
  // attaches the auth cookie automatically (withCredentials on the
  // EventSource + CORS credentials on the API).
  importExecuteUrl: (jobId: string, sendEmail: boolean) =>
    `${BASE}/api/employees/import/execute?jobId=${encodeURIComponent(jobId)}&sendEmail=${sendEmail}`,
};

// ---------------------------------------------------------------------------
// Managers — Peer Coverage
// ---------------------------------------------------------------------------

const managers = {
  // Eligible peer managers (same team, Manager role, excluding self).
  peers: (signal?: AbortSignal) =>
    get<ApiPeerManager[]>('/api/managers/peers', signal),

  // The caller's persisted peer-coverage tabs (self-healing: server prunes
  // any peer that's no longer a valid same-team manager).
  peerTabs: (signal?: AbortSignal) =>
    get<ApiPeerManager[]>('/api/managers/peer-tabs', signal),

  // Pin a peer tab. Returns the peer DTO. Idempotent server-side.
  addPeerTab: (peerManagerId: string) =>
    post<ApiPeerManager>('/api/managers/peer-tabs', { peerManagerId }),

  // Unpin a peer tab. 204 whether or not it existed.
  removePeerTab: (peerManagerId: string) =>
    del<void>(`/api/managers/peer-tabs/${encodeURIComponent(peerManagerId)}`),
};

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

const allocations = {
  list: (query?: {
    employeeId?: string;
    managerId?: string;
    month?: string;
    year?: string;
    status?: 'Draft' | 'PendingReview' | 'Approved' | 'NeedsRevision';
  }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query?.employeeId) params.set('employeeId', query.employeeId);
    if (query?.managerId)  params.set('managerId',  query.managerId);
    if (query?.month)      params.set('month',      query.month);
    if (query?.year)       params.set('year',       query.year);
    if (query?.status)     params.set('status',     query.status);
    const qs = params.toString();
    return get<ApiAllocationRecord[]>(`/api/allocations${qs ? `?${qs}` : ''}`, signal);
  },

  getOne: (id: string) =>
    get<ApiAllocationRecord>(`/api/allocations/${encodeURIComponent(id)}`),

  // Read-only lifecycle timeline (submitted → returned → approved …), newest
  // first, with the actor joined in. Powers the Allocation History side panel.
  history: (id: string, signal?: AbortSignal) =>
    get<ApiAllocationHistoryEvent[]>(
      `/api/allocations/${encodeURIComponent(id)}/history`,
      signal,
    ),

  upsertDraft: (body: {
    employeeId: string;
    team: string;
    managerId?: string | null;
    month: string;
    year: string;
    monthIndex: number;
    streams: ApiWorkStream[];
  }) => post<ApiAllocationRecord>('/api/allocations', body),

  submit: (id: string, streams?: ApiWorkStream[]) =>
    post<ApiAllocationRecord>(
      `/api/allocations/${encodeURIComponent(id)}/submit`,
      streams ? { streams } : {},
    ),

  // `expectedStatus` is the wire status the reviewer saw when the page
  // loaded. The backend rejects the action with 409 if the record has since
  // changed (another manager actioned it first — Peer Coverage race guard).
  approve: (id: string, expectedStatus?: ApiAllocationRecord['status']) =>
    post<ApiAllocationRecord>(
      `/api/allocations/${encodeURIComponent(id)}/approve`,
      expectedStatus ? { expectedStatus } : {},
    ),

  returnForRevision: (
    id: string,
    feedback?: string,
    expectedStatus?: ApiAllocationRecord['status'],
  ) =>
    post<ApiAllocationRecord>(`/api/allocations/${encodeURIComponent(id)}/return`, {
      feedback,
      ...(expectedStatus ? { expectedStatus } : {}),
    }),

  managerEdit: (id: string, streams: ApiWorkStream[], clearFlags?: boolean) =>
    post<ApiAllocationRecord>(`/api/allocations/${encodeURIComponent(id)}/manager-edit`, {
      streams,
      clearFlags: clearFlags ?? true,
    }),

  flagActivity: (id: string, activityId: string, reason: string) =>
    patch<ApiAllocationRecord>(
      `/api/allocations/${encodeURIComponent(id)}/activities/${encodeURIComponent(activityId)}/flag`,
      { reason },
    ),

  unflagActivity: (id: string, activityId: string) =>
    del<ApiAllocationRecord>(
      `/api/allocations/${encodeURIComponent(id)}/activities/${encodeURIComponent(activityId)}/flag`,
    ),
};

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

const journal = {
  list: (query?: {
    employeeId?: string;
    year?: string;
    month?: string;
  }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query?.employeeId) params.set('employeeId', query.employeeId);
    if (query?.year)       params.set('year',       query.year);
    if (query?.month)      params.set('month',      query.month);
    const qs = params.toString();
    return get<ApiJournalEntry[]>(`/api/journal${qs ? `?${qs}` : ''}`, signal);
  },

  getByDate: (date: string) =>
    get<ApiJournalEntry>(`/api/journal/${encodeURIComponent(date)}`),

  upsert: (date: string, body: {
    content: string;
    blocks?: Array<{ id: string; startTime: string; endTime: string; description: string }>;
  }) => put<ApiJournalEntry>(`/api/journal/${encodeURIComponent(date)}`, body),

  delete: (date: string) =>
    del<void>(`/api/journal/${encodeURIComponent(date)}`),
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settings = {
  snapshot: (signal?: AbortSignal) =>
    get<ApiSettingsSnapshot>('/api/settings', signal),

  // Teams
  createTeam: (name: string, sortOrder?: number) =>
    post<{ id: number; name: string }>('/api/settings/teams', { name, sortOrder }),
  renameTeam: (id: number, name: string) =>
    put<{ id: number; name: string }>(`/api/settings/teams/${id}`, { name }),
  deleteTeam: (id: number) =>
    del<void>(`/api/settings/teams/${id}`),

  // Clients
  createClient: (name: string, sortOrder?: number) =>
    post<{ id: number; name: string }>('/api/settings/clients', { name, sortOrder }),
  renameClient: (id: number, name: string) =>
    put<{ id: number; name: string }>(`/api/settings/clients/${id}`, { name }),
  deleteClient: (id: number) =>
    del<void>(`/api/settings/clients/${id}`),

  // Main categories
  createMainCategory: (name: string, sortOrder?: number) =>
    post<{ id: number; name: string }>('/api/settings/main-categories', { name, sortOrder }),
  renameMainCategory: (id: number, name: string) =>
    put<{ id: number; name: string }>(`/api/settings/main-categories/${id}`, { name }),
  setMainCategoryClients: (id: number, clients: string[]) =>
    patch<{ id: number; name: string; clients: string[] }>(
      `/api/settings/main-categories/${id}/clients`,
      { clients },
    ),
  deleteMainCategory: (id: number) =>
    del<void>(`/api/settings/main-categories/${id}`),

  // Sub categories
  createSubCategory: (body: {
    name: string;
    parentMainCategoryId: number;
    clients?: string[];
    sortOrder?: number;
  }) => post<{ id: number; name: string }>('/api/settings/sub-categories', body),
  renameSubCategory: (id: number, name: string) =>
    put<{ id: number; name: string }>(`/api/settings/sub-categories/${id}`, { name }),
  setSubCategoryClients: (id: number, clients: string[]) =>
    patch<ApiSubCategoryClientsResult>(`/api/settings/sub-categories/${id}/clients`, { clients }),
  deleteSubCategory: (id: number) =>
    del<void>(`/api/settings/sub-categories/${id}`),

  // Work types
  createWorkType: (name: string, parents: string[]) =>
    post<{ workType: { id: number; name: string }; generatedRules: ApiGeneratedRule[] }>('/api/settings/work-types', { name, parents }),
  renameWorkType: (id: number, name: string) =>
    put<{ id: number; name: string }>(`/api/settings/work-types/${id}`, { name }),
  setWorkTypeParents: (id: number, parents: string[]) =>
    patch<ApiWorkTypeParentsResult>(`/api/settings/work-types/${id}/parents`, { parents }),
  bulkUpdateWorkTypeParents: (updates: Array<{ id: number; parents: string[] }>) =>
    post<{ generatedRules: ApiGeneratedRule[] }>('/api/settings/work-types/bulk-update-parents', { updates }),
  deleteWorkType: (id: number) =>
    del<void>(`/api/settings/work-types/${id}`),

  // Inference rules (bulk replace)
  bulkReplaceInferenceRules: (rules: Array<{
    keywords: string[];
    category: string;
    subCategory?: string | null;
    workType: string;
    sortOrder?: number;
  }>) => put<void>('/api/settings/inference-rules', { rules }),
};

// ---------------------------------------------------------------------------
// Notifications (manual reminders — Epic 2)
// ---------------------------------------------------------------------------

export interface ManualReminderResult {
  /** Manager ids that were emailed successfully. */
  sent: string[];
  /** Manager ids that were skipped, with a reason (e.g. no email on file). */
  skipped: { id: string; reason: string }[];
}

export interface ApiNotification {
  id: string;
  targetUserId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  actionUrl: string | null;
  createdAt: string;
}

const notifications = {
  // The caller's own notifications, newest first (the bell feed).
  list: (signal?: AbortSignal) =>
    get<ApiNotification[]>('/api/notifications', signal),

  // Create a notification for YOURSELF only (server forces targetUserId to
  // the authenticated user). Used by the client-side login scheduler.
  createSelf: (body: {
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    actionUrl?: string;
  }) => post<{ id: string }>('/api/notifications', body),

  markRead: (id: string) =>
    patch<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`),

  markAllRead: () =>
    post<{ ok: boolean; updated: number }>('/api/notifications/read-all'),

  // Finance-triggered overdue-allocation reminder. Sends one email + in-app
  // notification per selected manager for the given period.
  manualReminder: (managerIds: string[], month: string, year: string) =>
    post<ManualReminderResult>('/api/notifications/manual-reminder', {
      managerIds,
      month,
      year,
    }),
};

// ---------------------------------------------------------------------------
// Maintenance mode
// ---------------------------------------------------------------------------

export interface ApiMaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  /** ISO-8601, or null when the window is open-ended. */
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

const maintenance = {
  // PUBLIC — resolves for signed-out visitors too, so the gate can render the
  // announcement before anyone has a session. Polled on an interval by
  // useMaintenanceStatus.
  status: (signal?: AbortSignal) =>
    get<ApiMaintenanceStatus>('/api/maintenance', signal),

  // Admin only. Partial patch — omit a field to keep its stored value, send
  // null on the timestamps to clear the window.
  update: (body: {
    enabled: boolean;
    title?: string;
    message?: string;
    startsAt?: string | null;
    endsAt?: string | null;
  }) => put<ApiMaintenanceStatus>('/api/maintenance', body),
};

// ---------------------------------------------------------------------------
// Migration (one-time: localStorage blob → DB)
// ---------------------------------------------------------------------------

const migrate = {
  upload: (blob: unknown) =>
    post<{ seeded: Record<string, number> }>('/api/migrate', blob),
};

// ---------------------------------------------------------------------------
// Exported namespace
// ---------------------------------------------------------------------------

export const api = { auth, employees, managers, allocations, journal, settings, notifications, maintenance, migrate };
