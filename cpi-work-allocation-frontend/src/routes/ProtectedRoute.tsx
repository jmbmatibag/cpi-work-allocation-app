import { Navigate, Outlet, useLocation } from "react-router-dom";
import { primaryRole } from "cpi-work-allocation-shared";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath, type AppRole } from "./routeConfig";

interface ProtectedRouteProps {
  /**
   * Optional allow-list of roles.
   * - Omit to require only authentication (use as a layout guard).
   * - Provide to also enforce RBAC on a specific page.
   */
  roles?: readonly AppRole[];
  children?: React.ReactNode;
}

/**
 * Route guard for authentication and role-based access.
 *
 * Unauthenticated users are bounced to /login with the attempted
 * location preserved in state, so Login can return them there on
 * success.
 *
 * Authenticated users hitting a route none of their roles can access
 * are redirected to their primary-role home — not to a 403 page, and
 * not to NotFound. Silent redirect is the right UX here: it avoids
 * leaking the existence of privileged pages and keeps navigation
 * flowing.
 *
 * Multi-role: the allow-list passes if ANY of the user's roles
 * appears in it. A [Manager, Employee] user accessing a Manager-only
 * route is allowed even though Employee is also in their set.
 */
const ProtectedRoute = ({ roles, children }: ProtectedRouteProps) => {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !currentUser.roles.some((r) => roles.includes(r))) {
    return (
      <Navigate to={roleHomePath[primaryRole(currentUser.roles)]} replace />
    );
  }

  return children ? <>{children}</> : <Outlet />;
};

export default ProtectedRoute;
