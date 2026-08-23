import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMaintenanceStatus } from "@/hooks/useMaintenanceStatus";
import Maintenance from "@/pages/Maintenance";

/**
 * Routes that stay reachable while maintenance mode is ON.
 *
 * /login is the important one: without it an Admin who isn't already signed
 * in could never get in to turn maintenance back OFF. Non-admins can still
 * sign in through it — they just land on the announcement immediately after,
 * because the gate re-evaluates once their session resolves.
 *
 * The password links arrive by email to people with no session, and
 * /maintenance is the announcement itself (also the Admin's preview).
 */
const ALWAYS_ALLOWED = [
  "/login",
  "/setup-password",
  "/reset-password",
  "/maintenance",
];

/**
 * Global maintenance gate.
 *
 * When maintenance mode is on, every route renders the announcement page
 * instead of the app — for everyone except Admins, who pass through with a
 * banner (see MaintenanceBanner in the authenticated header).
 *
 * Mounted directly inside <BrowserRouter> so it can read the current path,
 * and inside <AuthProvider> so it can see the session's roles.
 */
const MaintenanceGate = ({ children }: { children: ReactNode }) => {
  const { status, isLoading: maintenanceLoading } = useMaintenanceStatus();
  const { currentUser, isLoading: authLoading } = useAuth();
  const location = useLocation();

  // First poll hasn't landed yet — render the app. Fail-open: a slow status
  // check must not flash a maintenance screen at users during normal
  // operation, which is the overwhelmingly common case.
  if (maintenanceLoading || !status.enabled) return <>{children}</>;

  if (ALWAYS_ALLOWED.includes(location.pathname)) return <>{children}</>;

  // Maintenance is ON and we don't yet know who this is. Hold on a neutral
  // screen rather than guessing: showing the app would leak it to a
  // non-admin, and showing the announcement would flash it at an Admin.
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" />
    );
  }

  if (currentUser?.roles.includes("Admin")) return <>{children}</>;

  return <Maintenance />;
};

export default MaintenanceGate;
