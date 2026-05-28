/**
 * Legacy mock data — updated for Phase P 3-level taxonomy.
 *
 * Taxonomy: Main Category → Sub Category → Work Type
 * Featured projects: Geniisys (under Projects) and Quick Policy
 * (delivered via Geniisys and Quick Policy sub categories).
 *
 * Do not add new imports of this file. New code should use the contexts.
 */

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  managerEmail: string;
  team: string;
}

export const mockEmployees: Employee[] = [
  { id: "EMP001", firstName: "Jose",    lastName: "Escobar",  email: "jose@cpi.com.ph",    role: "Software Engineer",    managerEmail: "head@cpi.com.ph", team: "IT/Platforms" },
  { id: "EMP002", firstName: "Juan",    lastName: "Dela Cruz",email: "jd@cpi.com.ph",      role: "HR Specialist",        managerEmail: "head@cpi.com.ph", team: "HR" },
  { id: "EMP004", firstName: "Carlos",  lastName: "Garcia",   email: "carlos@cpi.com.ph",  role: "Security Engineer",    managerEmail: "head@cpi.com.ph", team: "IT/Platforms" },
  { id: "EMP005", firstName: "Ana",     lastName: "Reyes",    email: "ana@cpi.com.ph",     role: "DevOps Engineer",      managerEmail: "head@cpi.com.ph", team: "IT/Platforms" },
  { id: "EMP006", firstName: "Rico",    lastName: "Mendoza",  email: "rico@cpi.com.ph",    role: "Geniisys Developer",   managerEmail: "head@cpi.com.ph", team: "Ancillary Solutions" },
  { id: "EMP007", firstName: "Paolo",   lastName: "Cruz",     email: "paolo@cpi.com.ph",   role: "QA Engineer",          managerEmail: "head@cpi.com.ph", team: "Ancillary Solutions" },
  { id: "EMP011", firstName: "Kim",     lastName: "Ramos",    email: "kim@cpi.com.ph",     role: "IT Support",           managerEmail: "head@cpi.com.ph", team: "IT/Platforms" },
  { id: "HEAD001", firstName: "Roberto",lastName: "Cruz",     email: "head@cpi.com.ph",role: "IT Department Head",   managerEmail: "",                    team: "IT/Platforms" },
];

// Dashboard mock data — consumed by CompanyMasterOverview.
// Follows the 3-level hierarchy: Main Category → Sub Category → Work Type.
export interface DashboardEmployee {
  id: string;
  name: string;
  email: string;
  team: string;
  manager: string;
  status: "Submitted" | "Pending";
  timestamp: string;
  completionPct: number;
  tasks: {
    category: string;
    subCategory?: string;
    taskName: string;
    percentage: number;
  }[];
}

export const dashboardEmployees: DashboardEmployee[] = [
  {
    id: "EMP001", name: "Jose Escobar", email: "jose@cpi.com.ph",
    team: "IT/Platforms", manager: "head@cpi.com.ph",
    status: "Submitted", timestamp: "2026-04-15 16:30", completionPct: 100,
    tasks: [
      { category: "Projects", subCategory: "Geniisys", taskName: "Implementation",     percentage: 30 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Testing",            percentage: 15 },
      { category: "Projects", subCategory: "Quick Policy",    taskName: "Implementation",     percentage: 25 },
      { category: "Projects", subCategory: "Quick Policy",    taskName: "Enhancement",        percentage: 15 },
      { category: "General Work",                       taskName: "Meetings",          percentage: 10 },
      { category: "General Work",                       taskName: "Documentation",     percentage: 5  },
    ],
  },
  {
    id: "EMP004", name: "Carlos Garcia", email: "carlos@cpi.com.ph",
    team: "IT/Platforms", manager: "head@cpi.com.ph",
    status: "Submitted", timestamp: "2026-04-10 11:00", completionPct: 100,
    tasks: [
      { category: "IT",                                 taskName: "Security",          percentage: 30 },
      { category: "IT",                                 taskName: "Security",          percentage: 20 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Implementation",    percentage: 30 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Testing",           percentage: 10 },
      { category: "General Work",                       taskName: "Communication",    percentage: 10 },
    ],
  },
  {
    id: "EMP005", name: "Ana Reyes", email: "ana@cpi.com.ph",
    team: "IT/Platforms", manager: "head@cpi.com.ph",
    status: "Submitted", timestamp: "2026-04-16 14:00", completionPct: 100,
    tasks: [
      { category: "IT",                                 taskName: "DevOps",            percentage: 25 },
      { category: "IT",                                 taskName: "Infrastructure",    percentage: 15 },
      { category: "IT",                                 taskName: "Monitoring",        percentage: 10 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Implementation",    percentage: 30 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Maintenance",       percentage: 10 },
      { category: "General Work",                       taskName: "Meetings",          percentage: 10 },
    ],
  },
  {
    id: "EMP006", name: "Rico Mendoza", email: "rico@cpi.com.ph",
    team: "Ancillary Solutions", manager: "head@cpi.com.ph",
    status: "Submitted", timestamp: "2026-04-15 15:00", completionPct: 100,
    tasks: [
      { category: "Projects", subCategory: "Geniisys", taskName: "Implementation",      percentage: 35 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Enhancement",         percentage: 15 },
      { category: "Projects", subCategory: "Quick Policy",    taskName: "Product Development", percentage: 30 },
      { category: "Projects", subCategory: "Quick Policy",    taskName: "Testing",             percentage: 10 },
      { category: "General Work",                       taskName: "Meetings",           percentage: 5  },
      { category: "General Work",                       taskName: "Documentation",      percentage: 5  },
    ],
  },
  {
    id: "EMP007", name: "Paolo Cruz", email: "paolo@cpi.com.ph",
    team: "Ancillary Solutions", manager: "head@cpi.com.ph",
    status: "Submitted", timestamp: "2026-04-16 16:00", completionPct: 100,
    tasks: [
      { category: "Projects", subCategory: "Geniisys", taskName: "Testing",        percentage: 35 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Testing",        percentage: 30 },
      { category: "Projects", subCategory: "Quick Policy",    taskName: "Testing",        percentage: 20 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Documentation",  percentage: 10 },
      { category: "General Work",                       taskName: "Meetings",       percentage: 5  },
    ],
  },
  {
    id: "EMP011", name: "Kim Ramos", email: "kim@cpi.com.ph",
    team: "IT/Platforms", manager: "head@cpi.com.ph",
    status: "Pending", timestamp: "", completionPct: 0, tasks: [],
  },
  {
    id: "HEAD001", name: "Roberto Cruz", email: "head@cpi.com.ph",
    team: "IT/Platforms", manager: "",
    status: "Submitted", timestamp: "2026-04-14 16:30", completionPct: 100,
    tasks: [
      { category: "Projects", subCategory: "Geniisys", taskName: "Planning",       percentage: 25 },
      { category: "Projects", subCategory: "Geniisys", taskName: "Meetings",       percentage: 15 },
      { category: "Projects", subCategory: "Quick Policy",    taskName: "Planning",       percentage: 15 },
      { category: "IT",                                 taskName: "Security",       percentage: 15 },
      { category: "IT",                                 taskName: "DevOps",         percentage: 10 },
      { category: "General Work",                       taskName: "Meetings",       percentage: 12 },
      { category: "General Work",                       taskName: "Administrative", percentage: 8  },
    ],
  },
  {
    id: "EMP002", name: "Juan Dela Cruz", email: "jd@cpi.com.ph",
    team: "HR", manager: "head@cpi.com.ph",
    status: "Pending", timestamp: "", completionPct: 0, tasks: [],
  },
];

export const teamList: string[] = Array.from(
  new Set(dashboardEmployees.map((e) => e.team)),
).sort();

/**
 * Project → client mapping seed. Mirrors the SEED_SUB_CATEGORIES clients
 * field in ClientsConfigContext. Kept here for tests and utilities that
 * import mock data directly without a React context.
 *
 */
export const mockProjectClientMap: Record<string, string[]> = {
  Geniisys:       ["AFPGEN", "AUII", "CPAIC"],
  "Quick Policy": ["AFPGEN", "AUII"],
};
