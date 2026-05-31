import { Navigate } from "react-router-dom";
import { primaryRole } from "cpi-work-allocation-shared";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath } from "./routeConfig";

/**
 * Resolves "/" to the correct landing page for the current user's
 * primary role (highest-privilege role wins for multi-role users):
 *   - Admin                   -> /employees
 *   - Manager / Employee      -> /dashboard
 *   - Finance                 -> /dashboard
 *
 * Sits inside the authenticated layout so ProtectedRoute has already
 * guaranteed `currentUser` is set by the time this renders — the null
 * check is a belt-and-braces safety net, not an expected code path.
 */
const RoleHomeRedirect = () => {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/login" replace />;
  return (
    <Navigate to={roleHomePath[primaryRole(currentUser.roles)]} replace />
  );
};

export default RoleHomeRedirect;
