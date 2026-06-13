import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, KeyRound, HelpCircle } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useAllocations } from "@/contexts/AllocationsContext";
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  routesForRolesAndGroup,
  type AppRoute,
  type AppRouteGroup,
} from "@/routes/routeConfig";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

/**
 * Sidebar section headers, keyed by route group. Kept here rather than
 * on the routes themselves because the labels are a presentation
 * concern, not a routing concern. Add a new entry if you add a new
 * group to AppRouteGroup.
 */
const SIDEBAR_GROUP_LABELS: Record<AppRouteGroup, string> = {
  workspace: "Workspace",
  management: "Management",
};

const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { currentUser, logout, isApiMode } = useAuth();
  const { records } = useAllocations();
  const { guard, isBlocked } = useUnsavedChangesGuard();
  const navigate = useNavigate();
  const [changePwOpen, setChangePwOpen] = useState(false);

  // Guard nav-link clicks: when the current page has unsaved changes, cancel
  // the link's own navigation and route the intent through the confirmation
  // dialog instead. When clean, let NavLink navigate normally (so modifier
  // clicks like ⌘-click still work).
  const handleNavClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (!isBlocked()) return;
      e.preventDefault();
      guard(() => navigate(path));
    },
    [guard, isBlocked, navigate],
  );

  // The sidebar never renders without a logged-in user — the
  // AuthenticatedLayout only mounts inside a ProtectedRoute. This
  // guard exists so TS narrows currentUser below and so a future
  // caller outside that layout doesn't crash.
  if (!currentUser) return null;

  // Which nav routes should show an attention dot.
  //
  // Phase K: `/allocations` gets a dot when the current user has any
  // record returned for revision. Other routes may join this set in
  // future phases (e.g., Team Hub for pending reviews in Phase M).
  const needsRevisionPaths = useMemo(() => {
    const paths = new Set<string>();
    const hasRevision = records.some(
      (r) =>
        r.employeeId === currentUser.id && r.status === "Needs Revision",
    );
    if (hasRevision) paths.add("/allocations");
    return paths;
  }, [records, currentUser.id]);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
            <img src="/cpi-logo.png" alt="CPI Logo" className="w-full h-full object-contain" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm text-sidebar-foreground truncate">
              Work Allocation Portal
            </span>
          )}
        </div>

        {/* User card */}
        {!collapsed && (
          <div className="px-4 py-3 border-b border-sidebar-border">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {currentUser.firstName} {currentUser.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {currentUser.jobTitle} · {currentUser.team}
            </p>
          </div>
        )}

        {/* Navigation — rendered from routeConfig, grouped by section.
            Iterating SIDEBAR_GROUP_LABELS keys means we render groups
            in the order declared above, and only render groups that
            have at least one route visible to this user. */}
        {(Object.keys(SIDEBAR_GROUP_LABELS) as AppRouteGroup[]).map((group) => {
          // Multi-role: union of routes across all of the user's roles.
          // A [Admin, Manager, Employee] user sees admin tools AND the
          // manager team-hub AND the employee workspace.
          const routes = routesForRolesAndGroup(currentUser.roles, group);
          if (routes.length === 0) return null;
          return (
            <SidebarNavGroup
              key={group}
              label={SIDEBAR_GROUP_LABELS[group]}
              routes={routes}
              collapsed={collapsed}
              attentionPaths={needsRevisionPaths}
              onNavClick={handleNavClick}
            />
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        {/* Help center — available to every signed-in user. Routed outside
            the role/group nav config, so it lives here in the footer. Styled
            identically to the buttons below for clean alignment. */}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className="w-full justify-start text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          onClick={() => guard(() => navigate("/help"))}
        >
          <HelpCircle className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Help &amp; Guides</span>}
        </Button>
        {isApiMode && (
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            className="w-full justify-start text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            onClick={() => setChangePwOpen(true)}
          >
            <KeyRound className="h-4 w-4" />
            {!collapsed && <span className="ml-2">Change Password</span>}
          </Button>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          onClick={() => guard(() => logout())}
        >
          <LogOut className="h-4 w-4 transition-colors" />
          {!collapsed && <span className="ml-2 transition-colors">Sign Out</span>}
        </Button>
      </SidebarFooter>

      <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
    </Sidebar>
  );
};

interface SidebarNavGroupProps {
  label: string;
  routes: readonly AppRoute[];
  collapsed: boolean;
  /**
   * Set of route paths that should render an attention dot.
   * Opaque to this component — parent decides what "needs
   * attention" means for each route.
   */
  attentionPaths: ReadonlySet<string>;
  /**
   * Click handler for each nav link. Receives the event + target path so the
   * unsaved-changes guard can cancel navigation and open the confirm dialog
   * (see UnsavedChangesContext).
   */
  onNavClick: (e: React.MouseEvent, path: string) => void;
}

/**
 * One labelled section of the sidebar. Dumb — just renders the routes
 * you hand it. All role/group filtering happens in the parent via
 * routeConfig helpers; all attention-signal logic flows in via
 * attentionPaths.
 */
const SidebarNavGroup = ({
  label,
  routes,
  collapsed,
  attentionPaths,
  onNavClick,
}: SidebarNavGroupProps) => (
  <SidebarGroup>
    <SidebarGroupLabel>{label}</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        {routes.map((route) => {
          const Icon = route.icon;
          const needsAttention = attentionPaths.has(route.path);
          return (
            <SidebarMenuItem key={route.path}>
              <SidebarMenuButton asChild>
                <NavLink
                  to={route.path}
                  end
                  onClick={(e) => onNavClick(e, route.path)}
                  className="relative hover:bg-sidebar-accent"
                  activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                >
                  <span className="relative">
                    <Icon className="mr-2 h-4 w-4" />
                    {/* Attention dot — orange to match the
                        Needs Revision status badge. Positioned at
                        the top-right of the icon so it's visible
                        both in expanded and collapsed sidebar
                        states. */}
                    {needsAttention && (
                      <span
                        className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar"
                        aria-label="Needs attention"
                      />
                    )}
                  </span>
                  {!collapsed && <span>{route.label}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
);

export default AppSidebar;
