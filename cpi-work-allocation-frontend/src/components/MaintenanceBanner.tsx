import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMaintenanceStatus } from "@/hooks/useMaintenanceStatus";

/**
 * Header chip reminding an Admin that they're inside the app only because
 * of the maintenance bypass — everyone else is looking at the announcement
 * right now. Renders nothing for anyone else, and nothing when the switch
 * is off.
 */
const MaintenanceBanner = () => {
  const { status } = useMaintenanceStatus();
  const { currentUser } = useAuth();

  if (!status.enabled) return null;
  if (!currentUser?.roles.includes("Admin")) return null;

  return (
    <Link
      to="/settings"
      title="Maintenance mode is on — all non-Admin users see the announcement page. Click to manage."
      className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
    >
      <Wrench className="h-3 w-3" />
      <span className="hidden sm:inline">Maintenance mode on</span>
    </Link>
  );
};

export default MaintenanceBanner;
