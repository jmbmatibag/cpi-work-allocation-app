import { Navigate, useLocation, type Location } from "react-router-dom";
import { primaryRole } from "cpi-work-allocation-shared";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath } from "./routeConfig";

interface PublicOnlyRouteProps {
  children: React.ReactNode;
}

/**
 * Inverse of ProtectedRoute.
 *
 * If an already-authenticated user navigates to /login we route them
 * onward — either to the destination they were originally trying to
 * reach (captured in location.state.from by ProtectedRoute) or to
 * their primary-role home page (highest-privilege role wins for
 * multi-role users).
 */
const PublicOnlyRoute = ({ children }: PublicOnlyRouteProps) => {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (currentUser) {
    const from = (location.state as { from?: Location } | null)?.from?.pathname;
    return (
      <Navigate
        to={from ?? roleHomePath[primaryRole(currentUser.roles)]}
        replace
      />
    );
  }

  return <>{children}</>;
};

export default PublicOnlyRoute;
