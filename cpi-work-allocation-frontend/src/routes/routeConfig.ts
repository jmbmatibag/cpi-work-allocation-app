import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  BookOpen,
  CalendarRange,
  ClipboardCheck,
  Users,
  UserCog,
  Settings,
  Building2,
} from "lucide-react";

import EmployeeDashboard from "@/pages/EmployeeDashboard";
import DailyJournal from "@/pages/DailyJournal";
import MonthlyAllocations from "@/pages/MonthlyAllocations";
import PerformanceReview from "@/pages/PerformanceReview";
import TeamHub from "@/pages/TeamHub";
import SettingsPage from "@/pages/SettingsPage";
import CompanyMasterOverview from "@/pages/CompanyMasterOverview";
import EmployeeManagement from "@/pages/EmployeeManagement";

export type AppRole = "Employee" | "Manager" | "Head" | "Finance" | "Admin";

/**
 * Sidebar grouping. "workspace" = the user's own work; "management" =
 * management tools (team hub, master overview, employees, settings).
 * Add a new group here and a matching entry in SIDEBAR_GROUP_LABELS in
 * AppSidebar if you need a third section.
 */
export type AppRouteGroup = "workspace" | "management";

export interface AppRoute {
  path: string;
  element: ComponentType;
  roles: readonly AppRole[];
  /** User-facing label — rendered in the sidebar and anywhere else navigation is listed. */
  label: string;
  /** Lucide icon for sidebar rendering. */
  icon: LucideIcon;
  group: AppRouteGroup;
}

// Roles that share the four workspace items (everything except Admin).
const WORKSPACE_ROLES: readonly AppRole[] = [
  "Employee",
  "Manager",
  "Head",
  "Finance",
];

/**
 * Single source of truth for authenticated, role-scoped routes.
 *
 * Adding a new page is a one-entry change: the router, RBAC guards,
 * and sidebar all derive from this array. No other file needs to
 * change.
 */
export const appRoutes: readonly AppRoute[] = [
  // -------------------------------------------------------------------
  // Workspace — visible to Employee, Manager, Head, Finance.
  // Admin lives entirely in the Management section.
  // -------------------------------------------------------------------
  {
    path: "/dashboard",
    element: EmployeeDashboard,
    roles: WORKSPACE_ROLES,
    label: "Personal Dashboard",
    icon: LayoutDashboard,
    group: "workspace",
  },
  {
    path: "/journal",
    element: DailyJournal,
    roles: WORKSPACE_ROLES,
    label: "Daily Journal",
    icon: BookOpen,
    group: "workspace",
  },
  {
    path: "/allocations",
    element: MonthlyAllocations,
    roles: WORKSPACE_ROLES,
    label: "Monthly Allocations",
    icon: CalendarRange,
    group: "workspace",
  },
  {
    path: "/performance",
    element: PerformanceReview,
    roles: WORKSPACE_ROLES,
    label: "Performance Summary",
    icon: ClipboardCheck,
    group: "workspace",
  },

  // -------------------------------------------------------------------
  // Management — role-specific.
  // -------------------------------------------------------------------
  {
    path: "/team-hub",
    element: TeamHub,
    roles: ["Manager", "Head"],
    label: "Team Hub",
    icon: Users,
    group: "management",
  },
  {
    path: "/master",
    element: CompanyMasterOverview,
    roles: ["Finance"],
    label: "Master Overview",
    icon: Building2,
    group: "management",
  },
  {
    path: "/employees",
    element: EmployeeManagement,
    roles: ["Admin"],
    label: "Employees",
    icon: UserCog,
    group: "management",
  },
  {
    path: "/settings",
    element: SettingsPage,
    roles: ["Admin"],
    label: "Settings",
    icon: Settings,
    group: "management",
  },
] as const;

/**
 * Role-aware landing page. Used by `/` redirect and by RBAC rejections
 * (a role bounced from a forbidden route lands here instead of a 404).
 *
 * For multi-role users this is keyed by `primaryRole(roles)` — the
 * highest-privilege role wins, so [Admin, Manager, Employee] lands at
 * /employees, not /dashboard.
 */
export const roleHomePath: Record<AppRole, string> = {
  Employee: "/dashboard",
  Manager: "/dashboard",
  Head: "/dashboard",
  Finance: "/dashboard",
  Admin: "/employees",
};

/**
 * All routes visible to a user with the given role set. A route is
 * visible if ANY of the user's roles matches the route's allow-list —
 * a [Manager, Employee] user sees the union of Manager-allowed and
 * Employee-allowed routes.
 */
export const routesForRoles = (
  roles: readonly AppRole[],
): readonly AppRoute[] =>
  appRoutes.filter((r) => r.roles.some((allowed) => roles.includes(allowed)));

/** All routes visible to a role set within a specific sidebar group. */
export const routesForRolesAndGroup = (
  roles: readonly AppRole[],
  group: AppRouteGroup,
): readonly AppRoute[] =>
  appRoutes.filter(
    (r) =>
      r.group === group && r.roles.some((allowed) => roles.includes(allowed)),
  );
