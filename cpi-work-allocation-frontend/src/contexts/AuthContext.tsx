import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDataClient } from "@/lib/dataClient";
import { api, ApiError } from "@/lib/apiClient";
import {
  useEmployees,
  type Employee,
  type UserRole,
} from "@/contexts/EmployeesContext";

// Re-export for backward compatibility. Many consumers imported
// UserRole from "@/contexts/AuthContext" pre-Phase-N — keeping the
// re-export means no cascade of import changes across the codebase.
export type { UserRole };

/**
 * AppUser — the session view of an employee. Same shape as Employee
 * minus the password. Consumers that need the session user import
 * this, not Employee.
 */
export interface AppUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /**
   * Multi-role: a user can carry any subset of UserRole. Permission
   * checks in route guards, page nav, and feature gates use
   * `roles.includes('X')` or the `hasAnyRole` helper from
   * cpi-work-allocation-shared. Use `primaryRole(roles)` to derive
   * a single canonical role for the landing-page redirect.
   */
  roles: UserRole[];
  team: string;
  /**
   * Id of this user's manager. null for top-of-chain (executives,
   * Finance controllers who don't report to anyone in-app). Used for
   * all filtering — the separate `managerName` field is display-only.
   *
   * Pre-Phase-H, manager relationships were name-string matches, which
   * broke when two people shared a first name (Carlos Reyes / Carlos
   * Garcia). This field is the single source of truth; any filtering
   * code that uses `managerName` instead is a bug.
   */
  managerId: string | null;
  /** Display-only. Kept in sync with the manager user's full name
   *  by EmployeesContext. */
  managerName: string;
  jobTitle: string;
}

interface AuthContextType {
  currentUser: AppUser | null;
  /** true while an async session check is in flight (API mode only) */
  isLoading: boolean;
  /** true when the app is wired to the real API (VITE_USE_API=true) */
  isApiMode: boolean;

  // ── Local-storage mode ────────────────────────────────────────────
  login: (email: string, password: string) => boolean;
  /** Validates credentials without starting a session. Used by the OTP flow. */
  checkCredentials: (email: string, password: string) => boolean;

  // ── API mode (two-step: password + OTP) ───────────────────────────
  /**
   * Step 1 of API login: POST /api/auth/login with `{email, password}`.
   * If the password is correct the server emails an OTP and the caller
   * transitions to the OTP entry screen. If the password is wrong the
   * promise rejects with an ApiError so the caller can surface the
   * generic "Invalid email or password" message.
   */
  loginWithPassword: (email: string, password: string) => Promise<void>;
  /**
   * Step 2 of API login: POST /api/auth/verify-otp → sets cookie + user.
   * `rememberMe` (Epic 2) extends the session to 7 days when true.
   */
  verifyAndLogin: (email: string, code: string, rememberMe?: boolean) => Promise<void>;

  // ── Shared ────────────────────────────────────────────────────────
  logout: () => void;
  /**
   * All registered users (passwords stripped). Delegates to
   * EmployeesContext — pre-Phase-N this returned a hardcoded
   * list; now it reflects the editable directory.
   *
   * Callers get a snapshot, not a subscription. If you need to
   * re-render when the directory changes, use useEmployees()
   * directly.
   */
  getAllUsers: () => AppUser[];
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  isLoading: false,
  isApiMode: false,
  login: () => false,
  checkCredentials: () => false,
  loginWithPassword: async () => {},
  verifyAndLogin: async () => {},
  logout: () => {},
  getAllUsers: () => [],
});

export const useAuth = () => useContext(AuthContext);

/** Strip password + return the session view of an Employee. */
const toAppUser = (e: Employee): AppUser => {
  const { password: _, ...rest } = e;
  return rest;
};

/**
 * Hydrate the persisted session against the current directory.
 * Defense in depth: even if a valid envelope is stored, we re-look
 * up the user's id in the directory. If the id no longer exists
 * (user deleted between sessions, directory reshape between
 * releases, or hand-edited localStorage), we drop the stored
 * session and return null. Also refreshes any fields that may have
 * changed since save (e.g. managerName re-sync after a rename).
 */
function hydrateSession(directory: readonly Employee[]): AppUser | null {
  const client = getDataClient();
  const stored = client.read<AppUser>("auth");
  if (!stored) return null;

  const fresh = directory.find((e) => e.id === stored.id);
  if (!fresh) {
    client.remove("auth");
    return null;
  }
  return toAppUser(fresh);
}

// ── Local-storage mode provider ──────────────────────────────────────────────

const LocalAuthProvider = ({ children }: { children: ReactNode }) => {
  const { employees, findByEmail } = useEmployees();

  // Lazy init runs once on mount during this first render —
  // `employees` is the initial directory snapshot at that point.
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() =>
    hydrateSession(employees),
  );

  // Mid-session defense: if the currently logged-in user is deleted
  // from the directory (by an admin in a different session, or by
  // this same session's admin UI later), invalidate the session.
  useEffect(() => {
    if (!currentUser) return;
    const stillExists = employees.some((e) => e.id === currentUser.id);
    if (!stillExists) {
      getDataClient().remove("auth");
      setCurrentUser(null);
    }
  }, [employees, currentUser]);

  const checkCredentials = (email: string, password: string): boolean => {
    const found = findByEmail(email);
    return !!(found && found.password === password);
  };

  const login = (email: string, password: string): boolean => {
    const found = findByEmail(email);
    if (found && found.password === password) {
      const user = toAppUser(found);
      setCurrentUser(user);
      getDataClient().write("auth", user);
      return true;
    }
    return false;
  };

  const logout = () => {
    setCurrentUser(null);
    getDataClient().remove("auth");
  };

  const getAllUsers = (): AppUser[] => employees.map(toAppUser);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isLoading: false,
        isApiMode: false,
        login,
        checkCredentials,
        loginWithPassword: async () => {},
        verifyAndLogin: async () => {},
        logout,
        getAllUsers,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ── API mode provider ─────────────────────────────────────────────────────────

const ApiAuthProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const { employees } = useEmployees();

  // GET /api/auth/me — establishes session on load / after refresh
  const { data: meData, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: ({ signal }) => api.auth.me(signal),
    retry: false,
    // Don't throw on 401 — it just means the user isn't logged in yet
    throwOnError: false,
  });

  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);

  useEffect(() => {
    if (!meData?.user) return;
    const apiUser = meData.user;
    // Derive managerName from the employees list (the API doesn't include it)
    const mgr = employees.find((e) => e.id === apiUser.managerId);
    const managerName = mgr
      ? `${mgr.firstName} ${mgr.lastName}`.trim()
      : "";
    setCurrentUser({
      id: apiUser.id,
      firstName: apiUser.firstName,
      lastName: apiUser.lastName,
      email: apiUser.email,
      roles: [...apiUser.roles],
      team: apiUser.team,
      managerId: apiUser.managerId,
      managerName,
      jobTitle: apiUser.jobTitle,
    });
  }, [meData, employees]);

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    await api.auth.login(email, password);
  }, []);

  const verifyAndLogin = useCallback(async (email: string, code: string, rememberMe = false) => {
    const { user } = await api.auth.verifyOtp(email, code, rememberMe);
    const mgr = employees.find((e) => e.id === user.managerId);
    const managerName = mgr
      ? `${mgr.firstName} ${mgr.lastName}`.trim()
      : "";
    const appUser: AppUser = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roles: [...user.roles],
      team: user.team,
      managerId: user.managerId,
      managerName,
      jobTitle: user.jobTitle,
    };
    setCurrentUser(appUser);
    qc.setQueryData(["auth", "me"], { user });
    // Employees query was in error state while unauthenticated — refetch now.
    qc.invalidateQueries({ queryKey: ["employees"] });
  }, [employees, qc]);

  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* ignore network errors on logout */ }
    setCurrentUser(null);
    qc.clear();
  }, [qc]);

  // Stub: password-based login is not used in API mode
  const login = useCallback(() => false, []);
  const checkCredentials = useCallback(() => false, []);
  const getAllUsers = useCallback((): AppUser[] => {
    return employees.map((e) => {
      const { password: _, ...rest } = e;
      return rest;
    });
  }, [employees]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isLoading,
        isApiMode: true,
        login,
        checkCredentials,
        loginWithPassword,
        verifyAndLogin,
        logout,
        getAllUsers,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ── Public export — dispatches based on VITE_USE_API ─────────────────────────

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const isApiMode = import.meta.env.VITE_USE_API === "true";
  if (isApiMode) {
    return <ApiAuthProvider>{children}</ApiAuthProvider>;
  }
  return <LocalAuthProvider>{children}</LocalAuthProvider>;
};
