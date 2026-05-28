import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDataClient } from "@/lib/dataClient";
import { api, ApiError } from "@/lib/apiClient";
import { primaryRole, type UserRole } from "cpi-work-allocation-shared";

// Re-export the shared union under the original symbol so existing
// imports from "@/contexts/EmployeesContext" keep working unchanged.
export type { UserRole };

/**
 * Employee — the full directory shape including the password.
 *
 * ⚠️ Demo-only security: passwords are stored in plaintext. This is
 * fine for a frontend-only demo where the entire directory lives in
 * localStorage — there's no real trust boundary here. When this app
 * moves to a real backend, passwords MUST be hashed server-side and
 * this `password` field should leave the client entirely; the client
 * should only ever submit credentials to an auth endpoint, never
 * store them.
 */
export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  /**
   * Multi-role: a user can carry any subset of UserRole. Common
   * combinations: [Manager, Employee] for a people manager who also
   * submits their own timesheet; [Admin, Manager, Employee] for a
   * department lead. Permissions across the app are the UNION of
   * the listed roles — checks use `roles.includes('X')` or the
   * `hasAnyRole` helper from cpi-work-allocation-shared.
   *
   * Use `primaryRole(roles)` to derive a single canonical role for
   * places that need one (landing page redirect, ID-prefix logic).
   */
  roles: UserRole[];
  team: string;
  /**
   * Id of this user's manager. null for top-of-chain (executives,
   * Finance controllers, or anyone who doesn't report to an in-app
   * user). Denormalized `managerName` is display-only and kept in
   * sync by this context.
   */
  managerId: string | null;
  managerName: string;
  jobTitle: string;
}

/**
 * Input to addEmployee / updateEmployee. Same shape as Employee but
 * id is auto-generated on create, and managerName is derived from
 * managerId by the context so callers don't need to maintain the
 * denormalization.
 */
export type EmployeeInput = Omit<Employee, "id" | "managerName">;

/**
 * CRUD result type — success or a typed failure reason. UIs prefer
 * this over thrown exceptions because forms can render inline
 * messages without try/catch. Reasons are machine-readable enums so
 * locale + formatting stay in the UI layer.
 */
export type EmployeeOpResult =
  | { ok: true }
  | { ok: false; reason: EmployeeOpError; message: string };

export type EmployeeOpError =
  | "EMAIL_IN_USE"
  | "SELF_DELETE"
  | "MANAGER_HAS_REPORTS"
  | "NOT_FOUND"
  | "INVALID_MANAGER"
  | "MANAGER_ROLE_REQUIRED"
  | "CANNOT_REMOVE_OWN_ADMIN"
  // Catch-all for unexpected API failures (network errors, 500s, etc.).
  // Surfaced to the user with the underlying message so problems aren't
  // silently swallowed by the fire-and-forget pattern that previously
  // returned ok:true even when the request had failed.
  | "API_ERROR";

interface EmployeesContextType {
  employees: Employee[];

  /** Single lookup by id. Returns undefined if not found. */
  getEmployee: (id: string) => Employee | undefined;

  /** Lookup by email (case-insensitive). For login and CSV import. */
  findByEmail: (email: string) => Employee | undefined;

  /**
   * All employees reporting (directly) to the given manager id.
   * Empty array if none. Used by the UI for delete-guards and
   * team-by-manager grouping.
   */
  getReports: (managerId: string) => Employee[];

  /**
   * Create a new employee. Generates an id based on the primary role
   * in the array (ADM > HEAD > FIN > MGR > EMP). Refuses if the
   * email is already in use.
   *
   * Returns a Promise so the API-mode provider can wait for the
   * server response and surface real errors. The local-mode provider
   * resolves synchronously; callers should still `await` so both
   * providers behave identically.
   */
  addEmployee: (input: EmployeeInput) => Promise<EmployeeOpResult>;

  /**
   * Update an existing employee. If managerId changes, managerName
   * is re-synced from the new manager. If this employee IS a manager
   * and their name changed, all their reports' managerName is also
   * re-synced.
   *
   * Refuses if:
   *   - id not found
   *   - email change collides with another employee
   *   - the Manager role would be removed while reports still point at them
   *   - the requesting user is trying to remove Admin from themselves
   */
  updateEmployee: (
    id: string,
    patch: Partial<EmployeeInput>,
  ) => Promise<EmployeeOpResult>;

  /**
   * Remove an employee. Refuses if:
   *   - this employee is the currently logged-in user (selfId guard)
   *   - this employee has the Manager role and active reports
   *
   * `selfId` — pass the currently-logged-in user's id so the context
   * can enforce the self-delete refusal without depending on
   * AuthContext directly (which would create a cycle).
   */
  removeEmployee: (
    id: string,
    selfId: string | null,
  ) => Promise<EmployeeOpResult>;

  /**
   * Bulk-add multiple employees in a single state transaction.
   * NOTE: Declared in the interface but NOT YET IMPLEMENTED. The
   * provider does not supply this method; CSV import currently
   * routes through `addEmployee` in a loop via `@/lib/csvImport.ts`.
   * Marked optional so consumers can chain an existence check until
   * the bulk path lands.
   */
  bulkAddEmployees?: (
    inputs: readonly BulkEmployeeInput[],
  ) => Promise<EmployeeOpResult[]>;

  /**
   * Rename a team across every employee who currently has it as their
   * team. Called by Admin Settings when the team rename in
   * ClientsConfig is committed, so the denormalized team field on
   * each employee stays consistent with the source list.
   *
   * No-op if no employees match. Does not validate that newName is
   * unique against other teams — that's the caller's responsibility.
   */
  renameTeam: (oldName: string, newName: string) => void;
}

/**
 * Bulk-add input shape. Differs from EmployeeInput by using
 * managerEmail (string) instead of managerId — the context
 * resolves the email to an id at commit time so references to
 * managers being created in the same batch work.
 */
export type BulkEmployeeInput = Omit<EmployeeInput, "managerId"> & {
  managerEmail: string | null;
};
const EmployeesContext = createContext<EmployeesContextType | null>(null);

export const useEmployees = () => {
  const ctx = useContext(EmployeesContext);
  if (!ctx) {
    throw new Error("useEmployees must be used inside EmployeesProvider");
  }
  return ctx;
};

// ---------------------------------------------------------------------
// Seed directory — matches the pre-Phase-N hardcoded list in
// AuthContext. Only used on first mount when storage is empty.
// ---------------------------------------------------------------------

const MGR_CARLOS_REYES = "MGR001";

// Multi-role assignments mirror the backend seed. Permissions are the
// UNION of the listed roles — see cpi-work-allocation-shared/primaryRole
// for the helper used to pick a single canonical role when one is needed.
const SEED_EMPLOYEES: Employee[] = [
  // ── Employees under Carlos Reyes (MGR001, IT Director) ──────────────
  { id: "EMP001",  firstName: "Jose",     lastName: "Escobar",    email: "jose@cpi.com.ph",     password: "pass123",    roles: ["Employee"],                       team: "IT/Platforms",      managerId: MGR_CARLOS_REYES, managerName: "Carlos Reyes", jobTitle: "Software Engineer"   },
  { id: "EMP004",  firstName: "Carlos",   lastName: "Garcia",     email: "carlos@cpi.com.ph",   password: "pass123",    roles: ["Employee"],                       team: "IT/Platforms",      managerId: MGR_CARLOS_REYES, managerName: "Carlos Reyes", jobTitle: "Security Engineer"   },
  { id: "EMP011",  firstName: "Kim",      lastName: "Ramos",      email: "kim@cpi.com.ph",      password: "pass123",    roles: ["Employee"],                       team: "IT/Platforms",      managerId: MGR_CARLOS_REYES, managerName: "Carlos Reyes", jobTitle: "IT Support"          },
  { id: "EMP005",  firstName: "Ana",      lastName: "Reyes",      email: "ana@cpi.com.ph",      password: "pass123",    roles: ["Employee"],                       team: "IT/Platforms",      managerId: MGR_CARLOS_REYES, managerName: "Carlos Reyes", jobTitle: "DevOps Engineer"     },
  { id: "EMP006",  firstName: "Rico",     lastName: "Mendoza",    email: "rico@cpi.com.ph",     password: "pass123",    roles: ["Employee"],                       team: "Ancillary Solutions", managerId: MGR_CARLOS_REYES, managerName: "Carlos Reyes", jobTitle: "Geniisys Developer"  },
  { id: "EMP007",  firstName: "Paolo",    lastName: "Cruz",       email: "paolo@cpi.com.ph",    password: "pass123",    roles: ["Employee"],                       team: "Ancillary Solutions", managerId: MGR_CARLOS_REYES, managerName: "Carlos Reyes", jobTitle: "Geniisys QA Engineer"},
  { id: "EMP002",  firstName: "Juan",     lastName: "Dela Cruz",  email: "jd@cpi.com.ph",       password: "pass123",    roles: ["Employee"],                       team: "HR",                managerId: MGR_CARLOS_REYES, managerName: "Carlos Reyes", jobTitle: "HR Specialist"       },
  // ── Multi-role users (Manager / Admin / Finance) ────────────────────
  { id: "EMP003",        firstName: "Maria",    lastName: "Santos", email: "maria@cpi.com.ph",     password: "pass123",    roles: ["Manager", "Employee"],            team: "Ancillary Solutions", managerId: null, managerName: "VP Operations", jobTitle: "Project Manager"    },
  { id: MGR_CARLOS_REYES, firstName: "Carlos",  lastName: "Reyes",  email: "jbmatibag@cpi.com.ph", password: "admin123",   roles: ["Admin", "Manager", "Employee"],   team: "IT/Platforms",      managerId: null, managerName: "VP Operations", jobTitle: "IT Director"        },
  { id: "FIN001",        firstName: "Patricia", lastName: "Lim",    email: "finance@cpi.com.ph",   password: "finance123", roles: ["Finance", "Employee"],            team: "Finance",            managerId: null, managerName: "VP Operations", jobTitle: "Finance Controller" },
  { id: "HEAD001",       firstName: "Roberto",  lastName: "Cruz",   email: "head@cpi.com.ph",      password: "head123",    roles: ["Admin", "Manager", "Employee"],   team: "IT/Platforms",      managerId: null, managerName: "CEO",           jobTitle: "IT Department Head" },
];

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const normalizeEmail = (e: string) => e.trim().toLowerCase();

/**
 * Generate a new id with the given prefix. Monotonic suffix derived
 * from the max existing id with that prefix, + 1. Pads to 3 digits
 * so MGR010 sorts after MGR009. Sufficient for demo scale (thousands
 * of employees would still be fine); collision-free because we're
 * looking at the actual current list.
 */
const nextId = (prefix: string, existing: readonly Employee[]): string => {
  let max = 0;
  for (const e of existing) {
    if (!e.id.startsWith(prefix)) continue;
    const suffix = parseInt(e.id.slice(prefix.length), 10);
    if (Number.isFinite(suffix) && suffix > max) max = suffix;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
};

const prefixForRole = (role: UserRole): string => {
  if (role === "Manager") return "MGR";
  if (role === "Finance") return "FIN";
  if (role === "Head") return "HEAD";
  if (role === "Admin") return "ADM";
  return "EMP";
};

/**
 * Pre-Phase-N legacy hydration: localStorage blobs from before the
 * multi-role migration stored a single `role: UserRole` field instead
 * of `roles: UserRole[]`. Wrap legacy records into a one-element array
 * so the rest of the app sees a uniform shape.
 *
 * Pure function — given the same input it returns the same output, so
 * stable across re-renders for memoization purposes.
 */
const normalizeStoredEmployees = (raw: unknown): Employee[] | null => {
  if (!Array.isArray(raw)) return null;
  return raw.map((e) => {
    const candidate = e as Partial<Employee> & { role?: UserRole };
    if (Array.isArray(candidate.roles)) {
      return candidate as Employee;
    }
    // Legacy single-role record. Coerce to a one-element array; default
    // to ['Employee'] if neither field is present (corrupted record).
    const legacyRole: UserRole = candidate.role ?? "Employee";
    const { role: _drop, ...rest } = candidate;
    return { ...rest, roles: [legacyRole] } as Employee;
  });
};

const formatName = (first: string, last: string) =>
  `${first.trim()} ${last.trim()}`.trim();

// ---------------------------------------------------------------------
// Local-storage provider
// ---------------------------------------------------------------------

const LocalEmployeesProvider = ({ children }: { children: ReactNode }) => {
  // Lazy hydrate from storage; fall back to seed on missing / invalid.
  // Legacy single-role records are coerced to the new multi-role shape
  // by normalizeStoredEmployees on the way in.
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const stored = normalizeStoredEmployees(
      getDataClient().read<unknown>("employees"),
    );
    return stored ?? SEED_EMPLOYEES;
  });

  // Persist on any change. Full array write per mutation; same pattern
  // as the other contexts.
  useEffect(() => {
    getDataClient().write("employees", employees);
  }, [employees]);

  const getEmployee = useCallback(
    (id: string) => employees.find((e) => e.id === id),
    [employees],
  );

  const findByEmail = useCallback(
    (email: string) => {
      const needle = normalizeEmail(email);
      return employees.find((e) => normalizeEmail(e.email) === needle);
    },
    [employees],
  );

  const getReports = useCallback(
    (managerId: string) => employees.filter((e) => e.managerId === managerId),
    [employees],
  );

  const addEmployee = useCallback<EmployeesContextType["addEmployee"]>(
    async (input) => {
      const email = normalizeEmail(input.email);
      if (employees.some((e) => normalizeEmail(e.email) === email)) {
        return {
          ok: false,
          reason: "EMAIL_IN_USE",
          message: `Email "${input.email}" is already in use.`,
        };
      }

      // If a managerId is specified, it must point to an existing user
      // whose role set INCLUDES 'Manager'. Multi-role users (e.g. an
      // Admin+Manager) qualify; the previous strict equality check
      // would have rejected them.
      let managerName = "";
      if (input.managerId) {
        const mgr = employees.find((e) => e.id === input.managerId);
        if (!mgr) {
          return {
            ok: false,
            reason: "INVALID_MANAGER",
            message: `Manager id "${input.managerId}" does not exist.`,
          };
        }
        if (!mgr.roles.includes("Manager")) {
          return {
            ok: false,
            reason: "MANAGER_ROLE_REQUIRED",
            message: `${formatName(mgr.firstName, mgr.lastName)} is not a Manager.`,
          };
        }
        managerName = formatName(mgr.firstName, mgr.lastName);
      }

      // ID prefix derived from the highest-privilege role in the set —
      // an [Admin, Manager, Employee] user gets ADMnnn, not MGRnnn.
      const id = nextId(prefixForRole(primaryRole(input.roles)), employees);
      const newEmployee: Employee = {
        ...input,
        id,
        email,
        managerName,
      };
      setEmployees((prev) => [...prev, newEmployee]);
      return { ok: true };
    },
    [employees],
  );

  const updateEmployee = useCallback<EmployeesContextType["updateEmployee"]>(
    async (id, patch) => {
      const target = employees.find((e) => e.id === id);
      if (!target) {
        return {
          ok: false,
          reason: "NOT_FOUND",
          message: `Employee "${id}" does not exist.`,
        };
      }

      // Email collision check — only if email is being changed.
      if (patch.email !== undefined) {
        const nextEmail = normalizeEmail(patch.email);
        const collision = employees.find(
          (e) => e.id !== id && normalizeEmail(e.email) === nextEmail,
        );
        if (collision) {
          return {
            ok: false,
            reason: "EMAIL_IN_USE",
            message: `Email "${patch.email}" is already in use by ${formatName(collision.firstName, collision.lastName)}.`,
          };
        }
      }

      // Role demotion guard — if target currently has the Manager
      // role and the patch drops it, refuse while reports still point
      // at them. A multi-role user keeping Manager + adding Admin
      // doesn't trip the guard; only the actual removal of Manager
      // does.
      if (
        patch.roles !== undefined &&
        target.roles.includes("Manager") &&
        !patch.roles.includes("Manager")
      ) {
        const reports = employees.filter((e) => e.managerId === id);
        if (reports.length > 0) {
          return {
            ok: false,
            reason: "MANAGER_HAS_REPORTS",
            message:
              `${formatName(target.firstName, target.lastName)} has ${reports.length} ` +
              `direct ${reports.length === 1 ? "report" : "reports"}. Reassign ` +
              `before removing the Manager role.`,
          };
        }
      }

      // Manager reassignment validation — must resolve to a user whose
      // role set includes 'Manager'.
      let newManagerName = target.managerName;
      if (patch.managerId !== undefined) {
        if (patch.managerId === null) {
          newManagerName = "";
        } else {
          const mgr = employees.find((e) => e.id === patch.managerId);
          if (!mgr) {
            return {
              ok: false,
              reason: "INVALID_MANAGER",
              message: `Manager id "${patch.managerId}" does not exist.`,
            };
          }
          if (!mgr.roles.includes("Manager")) {
            return {
              ok: false,
              reason: "MANAGER_ROLE_REQUIRED",
              message: `${formatName(mgr.firstName, mgr.lastName)} is not a Manager.`,
            };
          }
          newManagerName = formatName(mgr.firstName, mgr.lastName);
        }
      }

      setEmployees((prev) => {
        // First pass — apply the patch to the target.
        const nextList = prev.map((e) => {
          if (e.id !== id) return e;
          return {
            ...e,
            ...patch,
            email:
              patch.email !== undefined ? normalizeEmail(patch.email) : e.email,
            managerName: newManagerName,
          };
        });

        // Second pass — if the target IS a manager and their name
        // changed, re-sync managerName on all their reports. Also
        // handles the case where target was demoted (no longer a
        // manager) but still denormalized in old reports —
        // shouldn't happen given the MANAGER_HAS_REPORTS guard, but
        // defensive.
        const target2 = nextList.find((e) => e.id === id)!;
        const oldName = formatName(target.firstName, target.lastName);
        const newName = formatName(target2.firstName, target2.lastName);
        if (oldName !== newName) {
          return nextList.map((e) =>
            e.managerId === id ? { ...e, managerName: newName } : e,
          );
        }
        return nextList;
      });

      return { ok: true };
    },
    [employees],
  );

  const removeEmployee = useCallback<EmployeesContextType["removeEmployee"]>(
    async (id, selfId) => {
      if (selfId === id) {
        return {
          ok: false,
          reason: "SELF_DELETE",
          message:
            "You cannot delete your own account while logged in. Ask another admin to remove you.",
        };
      }
      const target = employees.find((e) => e.id === id);
      if (!target) {
        return {
          ok: false,
          reason: "NOT_FOUND",
          message: `Employee "${id}" does not exist.`,
        };
      }
      if (target.roles.includes("Manager")) {
        const reports = employees.filter((e) => e.managerId === id);
        if (reports.length > 0) {
          return {
            ok: false,
            reason: "MANAGER_HAS_REPORTS",
            message:
              `${formatName(target.firstName, target.lastName)} has ` +
              `${reports.length} direct ${reports.length === 1 ? "report" : "reports"}. ` +
              `Reassign before deleting.`,
          };
        }
      }
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      return { ok: true };
    },
    [employees],
  );

  /**
   * Rename a team across all employees. Used by Admin Settings after
   * a team rename in ClientsConfig to keep the denormalized team
   * field on each employee in sync with the source list.
   */
  const renameTeam = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName) return;
      setEmployees((prev) =>
        prev.map((e) => (e.team === oldName ? { ...e, team: newName } : e)),
      );
    },
    [],
  );

  return (
    <EmployeesContext.Provider
      value={{
        employees,
        getEmployee,
        findByEmail,
        getReports,
        addEmployee,
        updateEmployee,
        removeEmployee,
        renameTeam,
      }}
    >
      {children}
    </EmployeesContext.Provider>
  );
};

// ---------------------------------------------------------------------
// API-backed provider (React Query)
// ---------------------------------------------------------------------

/**
 * Map a thrown ApiError (or unknown error) into the EmployeeOpResult
 * shape that callers expect. Surfaces the server's error code as the
 * `reason` so existing inline toast/banner rendering works unchanged.
 *
 * `context` carries enough form data to produce a human-friendly
 * message when the server didn't include one — e.g. echoing the
 * conflicting email back to the user instead of the bare error code.
 */
function apiErrorToOpResult(
  err: unknown,
  context?: { email?: string },
): EmployeeOpResult {
  if (err instanceof ApiError) {
    const body = (err.body ?? {}) as { error?: string; message?: string };
    const code = body.error ?? "API_ERROR";
    switch (code) {
      case "EMAIL_IN_USE":
        return {
          ok: false,
          reason: "EMAIL_IN_USE",
          message: context?.email
            ? `Email "${context.email}" is already in use.`
            : "That email is already in use.",
        };
      case "INVALID_MANAGER":
        return {
          ok: false,
          reason: "INVALID_MANAGER",
          message: "The selected manager does not exist.",
        };
      case "MANAGER_ROLE_REQUIRED":
        return {
          ok: false,
          reason: "MANAGER_ROLE_REQUIRED",
          message: "The selected user is not a Manager.",
        };
      case "MANAGER_HAS_REPORTS":
        return {
          ok: false,
          reason: "MANAGER_HAS_REPORTS",
          message:
            "This user still has direct reports — reassign them before " +
            "removing the Manager role or deleting the user.",
        };
      case "SELF_DELETE":
        return {
          ok: false,
          reason: "SELF_DELETE",
          message: "You cannot delete your own account while logged in.",
        };
      case "CANNOT_REMOVE_OWN_ADMIN":
        return {
          ok: false,
          reason: "CANNOT_REMOVE_OWN_ADMIN",
          message:
            body.message ??
            "You cannot remove the Admin role from yourself.",
        };
      default:
        // 404 "Employee not found" lands here. Use NOT_FOUND when the
        // status matches, otherwise the generic API_ERROR catch-all so
        // network/500 failures are still visible instead of silent.
        if (err.status === 404) {
          return {
            ok: false,
            reason: "NOT_FOUND",
            message: "That employee no longer exists.",
          };
        }
        return {
          ok: false,
          reason: "API_ERROR",
          message:
            body.message ??
            body.error ??
            `Request failed with status ${err.status}.`,
        };
    }
  }
  return {
    ok: false,
    reason: "API_ERROR",
    message: err instanceof Error ? err.message : "An unexpected error occurred.",
  };
}

const ApiEmployeesProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();

  const { data: apiUsers = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: ({ signal }) => api.employees.list(signal),
    staleTime: 60_000,
    retry: false,          // fail fast — invalidated and refetched after login
    throwOnError: false,   // don't crash when unauthenticated (renders empty array instead)
  });

  // Derive managerName for each employee from the same list. roles
  // arrive as an array straight from the API — no normalization needed
  // on this side.
  const employees: Employee[] = apiUsers.map((u) => {
    const mgr = apiUsers.find((m) => m.id === u.managerId);
    return {
      ...u,
      password: "",          // password never travels over the wire
      managerName: mgr ? `${mgr.firstName} ${mgr.lastName}`.trim() : "",
    };
  });

  const getEmployee = useCallback(
    (id: string) => employees.find((e) => e.id === id),
    [employees],
  );

  const findByEmail = useCallback(
    (email: string) => {
      const needle = email.trim().toLowerCase();
      return employees.find((e) => e.email.toLowerCase() === needle);
    },
    [employees],
  );

  const getReports = useCallback(
    (managerId: string) => employees.filter((e) => e.managerId === managerId),
    [employees],
  );

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["employees"] }),
    [qc],
  );

  const createMut = useMutation({
    mutationFn: (input: EmployeeInput & { id?: string }) =>
      api.employees.create({ ...input, id: input.id }),
    onSuccess: invalidate,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EmployeeInput> }) =>
      api.employees.update(id, patch),
    onSuccess: invalidate,
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.employees.remove(id),
    onSuccess: invalidate,
  });

  const addEmployee = useCallback<EmployeesContextType["addEmployee"]>(
    async (input) => {
      try {
        await createMut.mutateAsync(input);
        return { ok: true };
      } catch (err) {
        return apiErrorToOpResult(err, input);
      }
    },
    [createMut],
  );

  const updateEmployee = useCallback<EmployeesContextType["updateEmployee"]>(
    async (id, patch) => {
      try {
        await updateMut.mutateAsync({ id, patch });
        return { ok: true };
      } catch (err) {
        return apiErrorToOpResult(err, patch);
      }
    },
    [updateMut],
  );

  const removeEmployee = useCallback<EmployeesContextType["removeEmployee"]>(
    async (id, _selfId) => {
      try {
        await removeMut.mutateAsync(id);
        return { ok: true };
      } catch (err) {
        return apiErrorToOpResult(err);
      }
    },
    [removeMut],
  );

  // Team rename in API mode is handled server-side; no-op on the client
  const renameTeam = useCallback(() => {}, []);

  return (
    <EmployeesContext.Provider
      value={{
        employees,
        getEmployee,
        findByEmail,
        getReports,
        addEmployee,
        updateEmployee,
        removeEmployee,
        renameTeam,
      }}
    >
      {children}
    </EmployeesContext.Provider>
  );
};

// ---------------------------------------------------------------------
// Public export — dispatches based on VITE_USE_API
// ---------------------------------------------------------------------

export const EmployeesProvider = ({ children }: { children: ReactNode }) => {
  const isApiMode = import.meta.env.VITE_USE_API === "true";
  if (isApiMode) return <ApiEmployeesProvider>{children}</ApiEmployeesProvider>;
  return <LocalEmployeesProvider>{children}</LocalEmployeesProvider>;
};
