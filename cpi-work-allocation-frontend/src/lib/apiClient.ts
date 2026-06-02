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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

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
  mainCategories: Array<{ id: number; name: string; sortOrder: number }>;
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
        const PUBLIC_PATHS = ['/login', '/setup-password', '/reset-password'];
        if (!PUBLIC_PATHS.includes(window.location.pathname)) {
          window.location.href = '/login';
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

  // Step 2 (unchanged): exchanges the OTP for an authenticated session.
  verifyOtp: (email: string, code: string) =>
    post<{ user: ApiUser }>('/api/auth/verify-otp', { email, code }),

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
  // Re-issues fresh access + refresh cookies so the current session stays alive.
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ message: string }>('/api/auth/change-password', { currentPassword, newPassword }),

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

  approve: (id: string) =>
    post<ApiAllocationRecord>(`/api/allocations/${encodeURIComponent(id)}/approve`),

  returnForRevision: (id: string, feedback?: string) =>
    post<ApiAllocationRecord>(`/api/allocations/${encodeURIComponent(id)}/return`, { feedback }),

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
// Migration (one-time: localStorage blob → DB)
// ---------------------------------------------------------------------------

const migrate = {
  upload: (blob: unknown) =>
    post<{ seeded: Record<string, number> }>('/api/migrate', blob),
};

// ---------------------------------------------------------------------------
// Exported namespace
// ---------------------------------------------------------------------------

export const api = { auth, employees, allocations, journal, settings, migrate };
