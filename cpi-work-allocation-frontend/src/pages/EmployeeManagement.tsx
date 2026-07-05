import { useState, useMemo, useEffect } from "react";
import {
  useEmployees,
  type Employee,
  type EmployeeInput,
  type UserRole,
} from "@/contexts/EmployeesContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClientsConfig } from "@/contexts/ClientsConfigContext";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/apiClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { ImportEmployeesDialog } from "@/components/ImportEmployeesDialog";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  UserCog,
  Search,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  Mail,
  Bell,
  BellOff,
  Users,
  ArrowRightLeft,
  Crown,
  Upload,
  Download,
  CheckCircle2,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

// All assignable roles. Admins can pick any combination — there's no
// validation rule that, e.g., Admin and Employee are mutually exclusive.
const ROLE_OPTIONS: readonly UserRole[] = [
  "Employee",
  "Manager",
  "Finance",
  "Admin",
];

const roleBadgeClass = (role: UserRole): string => {
  switch (role) {
    case "Admin":    return "bg-warning/10 text-warning border-warning/30";
    case "Manager":  return "bg-primary/10 text-primary border-primary/30";
    case "Finance":  return "bg-purple-100 text-purple-800 border-purple-200";
    case "Employee": return "bg-muted text-muted-foreground";
  }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  id: string | null;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  roles: UserRole[];
  team: string;
  jobTitle: string;
  managerId: string | null;
  emailNotificationsExempt: boolean;
}

const emptyForm: FormState = {
  id: null,
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  roles: ["Employee"],
  team: "",
  jobTitle: "",
  managerId: null,
  emailNotificationsExempt: false,
};

const toEmployeeInput = (f: FormState): EmployeeInput => ({
  firstName: f.firstName.trim(),
  lastName:  f.lastName.trim(),
  email:     f.email.trim(),
  password:  f.password,
  roles:     [...f.roles],
  team:      f.team,
  jobTitle:  f.jobTitle.trim(),
  managerId: f.managerId,
  emailNotificationsExempt: f.emailNotificationsExempt,
});

function validate(form: FormState, _isEdit: boolean): string | null {
  if (!form.firstName.trim()) return "First name is required.";
  if (!form.lastName.trim()) return "Last name is required.";
  if (!form.email.trim()) return "Email is required.";
  if (!EMAIL_RE.test(form.email.trim())) return "Email format looks invalid.";
  if (form.roles.length === 0) return "At least one role is required.";
  if (!form.team) return "Team is required.";
  if (!form.jobTitle.trim()) return "Job title is required.";
  return null;
}

type ViewMode = "list" | "byManager";

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

const EmployeeManagement = () => {
  const { employees, addEmployee, updateEmployee, removeEmployee } = useEmployees();
  const { currentUser, isApiMode } = useAuth();
  const { teams } = useClientsConfig();
  const qc = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Clear selection whenever the user switches views.
  useEffect(() => {
    setSelectedEmployees([]);
    setSelectionResetKey((k) => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  // Bulk selection state
  const [selectedEmployees, setSelectedEmployees] = useState<Employee[]>([]);
  const [selectionResetKey, setSelectionResetKey] = useState(0);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkActionPending, setBulkActionPending] = useState(false);
  // Bulk "change manager" modal. `bulkManagerTarget` holds the chosen
  // manager id, or "__none__" for top-of-chain.
  const [bulkManagerOpen, setBulkManagerOpen] = useState(false);
  const [bulkManagerTarget, setBulkManagerTarget] = useState<string>("__none__");

  // --- CSV import (full flow lives inside ImportEmployeesDialog) ---
  const [importOpen, setImportOpen] = useState(false);

  const isEdit = form.id !== null;
  const editingSelf = form.id === currentUser?.id;

  const managerOptions = useMemo(
    () =>
      employees.filter(
        (e) => e.roles.includes("Manager") && e.id !== form.id,
      ),
    [employees, form.id],
  );

  // Filter predicate reused by both views so a search narrows both.
  // Multi-role: a "filter by Manager" selection matches anyone whose
  // role set includes Manager — so an [Admin, Manager] user appears in
  // both Admin and Manager filters.
  const matchesFilters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (e: Employee) => {
      if (
        filterRole !== "all" &&
        !e.roles.includes(filterRole as UserRole)
      ) {
        return false;
      }
      if (filterTeam !== "all" && e.team !== filterTeam) return false;
      if (!q) return true;
      const hay = `${e.firstName} ${e.lastName} ${e.email} ${e.id}`.toLowerCase();
      return hay.includes(q);
    };
  }, [search, filterRole, filterTeam]);

  // DataTable owns sorting and pagination; we only filter externally.
  const filtered = useMemo(
    () => employees.filter(matchesFilters),
    [employees, matchesFilters],
  );

  // For the By-Manager view: group reports by managerId.
  //
  // Three buckets:
  //   - `managerSections`: one section per Manager-role user, with
  //     that manager's reports (filtered).
  //   - `topOfChain`: users with managerId === null. Rendered as a
  //     single section at the top with the Crown icon.
  //   - `orphans`: users whose managerId points at an id that no
  //     longer exists. Shouldn't happen given context guards, but
  //     defensive — silent data loss would be worse than a visible
  //     orphan section. Rendered at the bottom.
  const byManager = useMemo(() => {
    const managers = employees
      .filter((e) => e.roles.includes("Manager"))
      .sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`,
        ),
      );

    const reportsByManager = new Map<string, Employee[]>();
    const topOfChain: Employee[] = [];
    const orphans: Employee[] = [];

    for (const emp of employees) {
      if (emp.managerId === null) {
        topOfChain.push(emp);
        continue;
      }
      const mgr = employees.find((m) => m.id === emp.managerId);
      if (!mgr) {
        orphans.push(emp);
        continue;
      }
      const list = reportsByManager.get(emp.managerId) ?? [];
      list.push(emp);
      reportsByManager.set(emp.managerId, list);
    }

    // Apply filters last so a manager section still renders even
    // when filters hide all their reports.
    const managerSections = managers.map((m) => ({
      manager: m,
      reports: (reportsByManager.get(m.id) ?? [])
        .filter(matchesFilters)
        .sort((a, b) =>
          `${a.firstName} ${a.lastName}`.localeCompare(
            `${b.firstName} ${b.lastName}`,
          ),
        ),
      totalReports: reportsByManager.get(m.id)?.length ?? 0,
    }));

    return {
      managerSections,
      topOfChain: topOfChain.filter(matchesFilters).sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`,
        ),
      ),
      orphans: orphans.filter(matchesFilters).sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`,
        ),
      ),
    };
  }, [employees, matchesFilters]);

  // --- Handlers ---

  const openAdd = () => {
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setForm({
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      email: emp.email,
      password: "",
      roles: [...emp.roles],
      team: emp.team,
      jobTitle: emp.jobTitle,
      managerId: emp.managerId,
      emailNotificationsExempt: emp.emailNotificationsExempt ?? false,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const err = validate(form, isEdit);
    if (err) {
      toast.error(err);
      return;
    }

    if (isEdit) {
      const patch: Partial<EmployeeInput> = toEmployeeInput(form);
      if (!form.password) delete (patch as { password?: string }).password;

      // Await the result so an API rejection (e.g. CANNOT_REMOVE_OWN_ADMIN
      // or MANAGER_HAS_REPORTS) surfaces as the actual error toast
      // instead of a misleading "updated" success message.
      const result = await updateEmployee(form.id!, patch);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        `${form.firstName} ${form.lastName} updated.`,
        editingSelf
          ? {
              description:
                "Your session keeps the old name/email until you log out and back in.",
            }
          : undefined,
      );
    } else {
      const result = await addEmployee(toEmployeeInput(form));
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`${form.firstName} ${form.lastName} added.`);
    }
    setModalOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await removeEmployee(deleteTarget.id, currentUser?.id ?? null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${deleteTarget.firstName} ${deleteTarget.lastName} removed.`);
    setDeleteTarget(null);
  };

  // Inline manager reassignment — called from the popover in each row.
  // Returns Promise<boolean> so the popover can wait before closing.
  const handleChangeManager = async (
    employeeId: string,
    newManagerId: string | null,
  ): Promise<boolean> => {
    const result = await updateEmployee(employeeId, { managerId: newManagerId });
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    const emp = employees.find((e) => e.id === employeeId);
    const newMgr = newManagerId
      ? employees.find((e) => e.id === newManagerId)
      : null;
    toast.success(
      newMgr
        ? `${emp?.firstName} now reports to ${newMgr.firstName} ${newMgr.lastName}.`
        : `${emp?.firstName} is now top of chain.`,
    );
    return true;
  };

  const handleClearSelection = () => {
    setSelectedEmployees([]);
    setSelectionResetKey((k) => k + 1);
  };

  // --- Bulk action handlers ---

  const handleBulkDelete = async () => {
    setBulkDeleteOpen(false);
    setBulkActionPending(true);
    const ids = selectedEmployees.map((e) => e.id);
    try {
      if (isApiMode) {
        const result = await api.employees.bulkDelete(ids);
        await qc.invalidateQueries({ queryKey: ["employees"] });
        const n = result.deleted.length;
        if (n > 0) toast.success(`Deleted ${n} employee${n === 1 ? "" : "s"}.`);
        if (result.skipped.length > 0)
          toast.warning(
            `${result.skipped.length} could not be deleted (manager with reports or self).`,
          );
      } else {
        let deleted = 0;
        let skipped = 0;
        for (const id of ids) {
          const res = await removeEmployee(id, currentUser?.id ?? null);
          if (res.ok) deleted++;
          else skipped++;
        }
        if (deleted > 0) toast.success(`Deleted ${deleted} employee${deleted === 1 ? "" : "s"}.`);
        if (skipped > 0) toast.warning(`${skipped} could not be deleted.`);
      }
    } catch {
      toast.error("Bulk delete failed. Please try again.");
    } finally {
      setBulkActionPending(false);
      setSelectedEmployees([]);
      setSelectionResetKey((k) => k + 1);
    }
  };

  const handleBulkResend = async () => {
    if (!isApiMode) return;
    setBulkActionPending(true);
    const ids = selectedEmployees.map((e) => e.id);
    try {
      const result = await api.employees.bulkResendWelcome(ids);
      const n = result.sent.length;
      if (n > 0) toast.success(`Welcome email sent to ${n} employee${n === 1 ? "" : "s"}.`);
      if (result.skipped.length > 0)
        toast.info(
          `${result.skipped.length} already completed setup — skipped.`,
        );
    } catch {
      toast.error("Could not send welcome emails. Please try again.");
    } finally {
      setBulkActionPending(false);
    }
  };

  // Bulk manager reassignment. No dedicated bulk endpoint exists, so we
  // fan out per-employee updates (the selection is small — a handful of
  // rows at demo scale). Skips no-ops and reports failures in aggregate.
  const handleBulkChangeManager = async () => {
    setBulkManagerOpen(false);
    setBulkActionPending(true);
    const newManagerId =
      bulkManagerTarget === "__none__" ? null : bulkManagerTarget;
    // Can't make a manager report to themselves.
    const targets = selectedEmployees.filter((e) => e.id !== newManagerId);
    let updated = 0;
    let failed = 0;
    for (const emp of targets) {
      const res = await updateEmployee(emp.id, { managerId: newManagerId });
      if (res.ok) updated++;
      else failed++;
    }
    setBulkActionPending(false);
    setSelectedEmployees([]);
    setSelectionResetKey((k) => k + 1);
    if (updated > 0) {
      const mgr = newManagerId
        ? employees.find((e) => e.id === newManagerId)
        : null;
      toast.success(
        mgr
          ? `${updated} employee${updated === 1 ? "" : "s"} now report to ${mgr.firstName} ${mgr.lastName}.`
          : `${updated} employee${updated === 1 ? "" : "s"} moved to top of chain.`,
      );
    }
    if (failed > 0)
      toast.warning(`${failed} could not be reassigned.`);
  };

  // Bulk toggle of the scheduled-reminders exemption. `exempt` true pauses
  // reminders; false re-enables them.
  const handleBulkToggleReminders = async (exempt: boolean) => {
    setBulkActionPending(true);
    const targets = [...selectedEmployees];
    let updated = 0;
    let failed = 0;
    for (const emp of targets) {
      const res = await updateEmployee(emp.id, {
        emailNotificationsExempt: exempt,
      });
      if (res.ok) updated++;
      else failed++;
    }
    setBulkActionPending(false);
    if (updated > 0)
      toast.success(
        exempt
          ? `Scheduled reminders paused for ${updated} employee${updated === 1 ? "" : "s"}.`
          : `Scheduled reminders enabled for ${updated} employee${updated === 1 ? "" : "s"}.`,
      );
    if (failed > 0) toast.warning(`${failed} could not be updated.`);
  };

  // Multi-role: each KPI counts users whose role set INCLUDES that
  // role, so a [Admin, Manager, Employee] user is counted in all
  // three. The sum of these counts therefore exceeds `total` — that's
  // intentional and matches how a user thinks about role coverage.
  const counts = useMemo(() => {
    let employees_ = 0;
    let managers = 0;
    let finance = 0;
    for (const e of employees) {
      if (e.roles.includes("Employee")) employees_++;
      if (e.roles.includes("Manager")) managers++;
      if (e.roles.includes("Finance")) finance++;
    }
    return { employees: employees_, managers, finance, total: employees.length };
  }, [employees]);

  // All users with the Manager role, for the Change-Manager popover dropdown.
  const allManagers = useMemo(
    () =>
      employees
        .filter((e) => e.roles.includes("Manager"))
        .sort((a, b) =>
          `${a.firstName} ${a.lastName}`.localeCompare(
            `${b.firstName} ${b.lastName}`,
          ),
        ),
    [employees],
  );

  // Column definitions for the DataTable list view.
  // Closures capture the handlers so cells can call them directly.
  const employeeColumns = useMemo<ColumnDef<Employee>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        accessorFn: (row) => `${row.firstName} ${row.lastName}`,
        cell: ({ row }) => {
          const emp = row.original;
          const isMe = emp.id === currentUser?.id;
          return (
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {emp.firstName} {emp.lastName}
                </span>
                {isMe && (
                  <Badge variant="outline" className="h-5 text-[10px] px-1.5">
                    You
                  </Badge>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {emp.id}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <span className="flex items-center gap-1 text-sm">
            <Mail className="h-3 w-3 text-muted-foreground" />
            {row.original.email}
          </span>
        ),
      },
      {
        id: "roles",
        header: "Role",
        accessorFn: (row) => row.roles.join(", "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roles.map((r) => (
              <Badge key={r} variant="outline" className={roleBadgeClass(r)}>
                {r}
              </Badge>
            ))}
          </div>
        ),
        sortingFn: (a, b) => {
          const order: Record<UserRole, number> = { Admin: 0, Manager: 1, Finance: 2, Employee: 3 };
          const rankA = Math.min(...a.original.roles.map((r) => order[r] ?? 99));
          const rankB = Math.min(...b.original.roles.map((r) => order[r] ?? 99));
          return rankA - rankB;
        },
      },
      {
        accessorKey: "team",
        header: "Team",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.team}</span>
        ),
      },
      {
        accessorKey: "jobTitle",
        header: "Job Title",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.jobTitle}</span>
        ),
      },
      {
        id: "manager",
        header: "Manager",
        accessorFn: (row) => row.managerName ?? "",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.managerName || <span className="italic">—</span>}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        size: 120,
        cell: ({ row }) => {
          const emp = row.original;
          return (
            <RowActions
              emp={emp}
              isMe={emp.id === currentUser?.id ?? false}
              allManagers={allManagers}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onChangeManager={handleChangeManager}
            />
          );
        },
      },
    ],
    [currentUser, allManagers, openEdit, setDeleteTarget, handleChangeManager],
  );

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <UserCog className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Employees</h1>
            <p className="text-sm text-muted-foreground">
              Manage employee directory, roles, and reporting lines.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="gap-1.5"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          <Button onClick={openAdd} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add Employee
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-3xl font-bold text-foreground tabular-nums">
              {counts.total}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Employees</p>
            <p className="text-3xl font-bold text-muted-foreground tabular-nums">
              {counts.employees}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Managers</p>
            <p className="text-3xl font-bold text-primary tabular-nums">
              {counts.managers}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Finance</p>
            <p className="text-3xl font-bold text-muted-foreground tabular-nums">
              {counts.finance}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + view toggle */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email, or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterTeam} onValueChange={setFilterTeam}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="h-10">
              <TabsTrigger value="list" className="gap-1.5">
                <UserCog className="h-3.5 w-3.5" />
                List
              </TabsTrigger>
              <TabsTrigger value="byManager" className="gap-1.5">
                <Users className="h-3.5 w-3.5" />
                By Manager
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {/* List view */}
      {viewMode === "list" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Directory
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filtered.length} {filtered.length === 1 ? "result" : "results"})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={employeeColumns}
              data={filtered}
              pageSize={10}
              emptyMessage="No employees match the current filters."
              defaultSorting={[{ id: "name", desc: false }]}
              selectable
              getRowId={(e) => e.id}
              onSelectionChange={setSelectedEmployees}
              resetKey={selectionResetKey}
            />
          </CardContent>
        </Card>
      )}

      {/* By-Manager view */}
      {viewMode === "byManager" && (
        <div className="space-y-4">
          {/* Top of chain (managerId === null) */}
          {byManager.topOfChain.length > 0 && (
            <ManagerSection
              headerIcon={<Crown className="h-4 w-4 text-warning" />}
              headerLabel="Top of Chain"
              headerSubtitle="No in-app manager"
              reports={byManager.topOfChain}
              totalReports={byManager.topOfChain.length}
              currentUserId={currentUser?.id ?? null}
              allManagers={allManagers}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onChangeManager={handleChangeManager}
            />
          )}

          {/* One section per manager */}
          {byManager.managerSections.map(({ manager, reports, totalReports }) => (
            <ManagerSection
              key={manager.id}
              headerIcon={
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary">
                  {manager.firstName[0]}
                  {manager.lastName[0]}
                </div>
              }
              headerLabel={`${manager.firstName} ${manager.lastName}`}
              headerSubtitle={`${manager.jobTitle} · ${manager.team}`}
              reports={reports}
              totalReports={totalReports}
              currentUserId={currentUser?.id ?? null}
              allManagers={allManagers}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onChangeManager={handleChangeManager}
            />
          ))}

          {/* Orphans — should be zero in normal operation. Visible so
              data issues don't fail silently. */}
          {byManager.orphans.length > 0 && (
            <ManagerSection
              headerIcon={<AlertCircle className="h-4 w-4 text-destructive" />}
              headerLabel="Orphaned"
              headerSubtitle="Manager id points at a user that no longer exists"
              reports={byManager.orphans}
              totalReports={byManager.orphans.length}
              currentUserId={currentUser?.id ?? null}
              allManagers={allManagers}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onChangeManager={handleChangeManager}
              variant="destructive"
            />
          )}
        </div>
      )}

      {/* Add/Edit modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isEdit ? "Edit Employee" : "Add Employee"}
              {editingSelf && (
                <Badge variant="outline" className="h-5 text-[10px] px-1.5">
                  You
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update the employee's details. Email and name changes propagate to their records."
                : "Create a new employee. They'll receive a welcome email and can sign in with the OTP code we send to their inbox."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fn">First Name</Label>
              <Input
                id="fn"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ln">Last Name</Label>
              <Input
                id="ln"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="em">Email</Label>
              <Input
                id="em"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            {/* <div className="col-span-2 space-y-1.5">
              <Label htmlFor="pw">
                Password
                {isEdit && (
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    (leave blank to keep current)
                  </span>
                )}
              </Label>
              <Input
                id="pw"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={isEdit ? "••••••••" : ""}
              />
              <p className="text-[10px] text-muted-foreground">
                Stored in plaintext for this demo. A real backend would hash this.
              </p>
            </div> */}
            <div className="space-y-1.5">
              <Label>Roles</Label>
              {/* Multi-select: a user can carry any combination. Order in
                  the array isn't semantic (the highest-privilege role is
                  picked automatically for the landing page / ID prefix
                  via primaryRole). */}
              <div className="grid grid-cols-2 gap-1.5 rounded-md border border-input px-3 py-2">
                {ROLE_OPTIONS.map((r) => {
                  const checked = form.roles.includes(r);
                  return (
                    <label
                      key={r}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          setForm((prev) => {
                            const has = prev.roles.includes(r);
                            if (next && !has) {
                              return { ...prev, roles: [...prev.roles, r] };
                            }
                            if (!next && has) {
                              return {
                                ...prev,
                                roles: prev.roles.filter((x) => x !== r),
                              };
                            }
                            return prev;
                          });
                        }}
                      />
                      <span>{r}</span>
                    </label>
                  );
                })}
              </div>
              {form.roles.length === 0 && (
                <p className="text-[11px] text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Pick at least one role.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm">Team</Label>
              <Select
                value={form.team}
                onValueChange={(v) => setForm({ ...form, team: v })}
              >
                <SelectTrigger id="tm">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="jt">Job Title</Label>
              <Input
                id="jt"
                value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="mg">Manager</Label>
              <Select
                value={form.managerId ?? "__none__"}
                onValueChange={(v) =>
                  setForm({ ...form, managerId: v === "__none__" ? null : v })
                }
              >
                <SelectTrigger id="mg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    No manager (top of chain)
                  </SelectItem>
                  {managerOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} ({m.team})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {managerOptions.length === 0 && !form.roles.includes("Manager") && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  No managers exist. Create a Manager first or leave as
                  top-of-chain.
                </p>
              )}
            </div>
            <div className="col-span-2 flex items-start justify-between gap-4 rounded-md border border-input px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="scheduled-reminders">
                  Receive Scheduled Reminders
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  If disabled, this employee will not receive automated
                  scheduled reminder emails.
                </p>
              </div>
              {/* Switch reads "receiving" (the positive framing); the stored
                  flag is the inverse (exempt). checked = !exempt. */}
              <Switch
                id="scheduled-reminders"
                checked={!form.emailNotificationsExempt}
                onCheckedChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    emailNotificationsExempt: !next,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {isEdit ? "Save Changes" : "Add Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV import — two-stage (analyze -> SSE execute) */}
      <ImportEmployeesDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={() => qc.invalidateQueries({ queryKey: ["employees"] })}
      />

      {/* Floating bulk action bar — shows when rows are selected (list view) */}
      <BulkActionBar
        count={selectedEmployees.length}
        isApiMode={isApiMode}
        pending={bulkActionPending}
        onChangeManager={() => {
          setBulkManagerTarget("__none__");
          setBulkManagerOpen(true);
        }}
        onSetReminders={handleBulkToggleReminders}
        onResend={handleBulkResend}
        onDelete={() => setBulkDeleteOpen(true)}
        onClear={handleClearSelection}
      />

      {/* Bulk change-manager modal */}
      <Dialog
        open={bulkManagerOpen}
        onOpenChange={(o) => !o && setBulkManagerOpen(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Change manager for {selectedEmployees.length}{" "}
              {selectedEmployees.length === 1 ? "employee" : "employees"}
            </DialogTitle>
            <DialogDescription>
              Reassign the selected employees to a new manager, or move them to
              the top of the chain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-mg">Manager</Label>
            <Select value={bulkManagerTarget} onValueChange={setBulkManagerTarget}>
              <SelectTrigger id="bulk-mg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  No manager (top of chain)
                </SelectItem>
                {allManagers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.firstName} {m.lastName} ({m.team})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkManagerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkChangeManager} disabled={bulkActionPending}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirm dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(o) => !o && setBulkDeleteOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedEmployees.length} employees?</DialogTitle>
            <DialogDescription>
              This will permanently remove the selected employees. Managers with
              active reports will be skipped automatically. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkActionPending}>
              Delete All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm modal */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Employee?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  This will permanently remove{" "}
                  <span className="font-medium text-foreground">
                    {deleteTarget.firstName} {deleteTarget.lastName}
                  </span>{" "}
                  from the directory. Their existing allocation records and
                  journal entries will remain but become orphaned.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------


interface ManagerSectionProps {
  headerIcon: React.ReactNode;
  headerLabel: string;
  headerSubtitle: string;
  reports: Employee[];
  totalReports: number;
  currentUserId: string | null;
  allManagers: readonly Employee[];
  onEdit: (emp: Employee) => void;
  onDelete: (emp: Employee) => void;
  onChangeManager: (
    employeeId: string,
    newManagerId: string | null,
  ) => Promise<boolean>;
  variant?: "default" | "destructive";
}

/**
 * One section in the By-Manager view. Collapsible? Not yet; at the
 * demo's scale (7–12 employees) flat is fine. Add a chevron toggle
 * if sections grow past ~8 reports each.
 */
const ManagerSection = ({
  headerIcon,
  headerLabel,
  headerSubtitle,
  reports,
  totalReports,
  currentUserId,
  allManagers,
  onEdit,
  onDelete,
  onChangeManager,
  variant = "default",
}: ManagerSectionProps) => {
  const hidden = totalReports - reports.length;

  return (
    <Card className={variant === "destructive" ? "border-destructive/30" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {headerIcon}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground">{headerLabel}</h3>
            <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {totalReports}{" "}
            {totalReports === 1 ? "report" : "reports"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {totalReports === 0
              ? "No reports."
              : `No reports match the current filters (${totalReports} hidden).`}
          </p>
        ) : (
          <>
            <div className="divide-y border rounded-md overflow-hidden">
              {reports.map((emp) => {
                const isMe = emp.id === currentUserId;
                return (
                  <div
                    key={emp.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {emp.firstName} {emp.lastName}
                        </span>
                        {isMe && (
                          <Badge variant="outline" className="h-5 text-[10px] px-1.5">
                            You
                          </Badge>
                        )}
                        {emp.roles.map((r) => (
                          <Badge
                            key={r}
                            variant="outline"
                            className={`${roleBadgeClass(r)} h-5 text-[10px] px-1.5`}
                          >
                            {r}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {emp.email} · {emp.team} · {emp.jobTitle}
                      </p>
                    </div>
                    <RowActions
                      emp={emp}
                      isMe={isMe}
                      allManagers={allManagers}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onChangeManager={onChangeManager}
                    />
                  </div>
                );
              })}
            </div>
            {hidden > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {hidden} more {hidden === 1 ? "report" : "reports"} hidden by filters.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

interface RowActionsProps {
  emp: Employee;
  isMe: boolean;
  allManagers: readonly Employee[];
  onEdit: (emp: Employee) => void;
  onDelete: (emp: Employee) => void;
  onChangeManager: (
    employeeId: string,
    newManagerId: string | null,
  ) => Promise<boolean>;
}

/**
 * Actions cluster: Change Manager (popover), Resend Welcome (API mode),
 * Edit (icon), Delete (icon).
 * Shared between the List view's DataTable column and the By-Manager row.
 */
const RowActions = ({
  emp,
  isMe,
  allManagers,
  onEdit,
  onDelete,
  onChangeManager,
}: RowActionsProps) => {
  const { isApiMode } = useAuth();
  const { updateEmployee } = useEmployees();
  const [popOpen, setPopOpen] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [reminderPending, setReminderPending] = useState(false);

  const remindersOn = !emp.emailNotificationsExempt;

  // Quick toggle mirroring the "Receive Scheduled Reminders" switch in the
  // edit modal, for one-click access straight from the row.
  const handleToggleReminders = async () => {
    setReminderPending(true);
    try {
      const result = await updateEmployee(emp.id, {
        emailNotificationsExempt: remindersOn,
      });
      if (result.ok) {
        toast.success(
          remindersOn
            ? `Scheduled reminders paused for ${emp.firstName}.`
            : `Scheduled reminders resumed for ${emp.firstName}.`,
        );
      } else {
        toast.error(result.message);
      }
    } finally {
      setReminderPending(false);
    }
  };

  const handleResend = async () => {
    setResendPending(true);
    try {
      const result = await api.employees.bulkResendWelcome([emp.id]);
      if (result.sent.includes(emp.id)) {
        toast.success(`Welcome email sent to ${emp.firstName}.`);
      } else {
        const skip = result.skipped.find((s) => s.id === emp.id);
        toast.info(skip?.reason ?? `Could not resend to ${emp.firstName}.`);
      }
    } catch {
      toast.error("Failed to send welcome email.");
    } finally {
      setResendPending(false);
    }
  };

  // Managers eligible as a target for this employee's "Change Manager"
  // action. Exclude the employee themselves (can't report to yourself).
  const eligibleManagers = allManagers.filter((m) => m.id !== emp.id);

  return (
    <div className="flex items-center justify-end gap-1">
      <Popover open={popOpen} onOpenChange={setPopOpen}>
        <PopoverTrigger asChild>
          <button
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label={`Change manager for ${emp.firstName} ${emp.lastName}`}
            title="Change manager"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <div className="space-y-2">
            <p className="font-semibold text-sm">Change Manager</p>
            <p className="text-xs text-muted-foreground">
              Reassign{" "}
              <span className="font-medium text-foreground">
                {emp.firstName} {emp.lastName}
              </span>{" "}
              to a new manager.
            </p>
            <div className="max-h-60 overflow-y-auto space-y-1 -mx-1 pt-1">
              <button
                onClick={async () => {
                  if (await onChangeManager(emp.id, null)) setPopOpen(false);
                }}
                disabled={emp.managerId === null}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Crown className="h-3 w-3 text-warning shrink-0" />
                <span className="flex-1">Top of chain</span>
                {emp.managerId === null && (
                  <span className="text-[10px] text-muted-foreground">
                    current
                  </span>
                )}
              </button>
              {eligibleManagers.map((m) => (
                <button
                  key={m.id}
                  onClick={async () => {
                    if (await onChangeManager(emp.id, m.id)) setPopOpen(false);
                  }}
                  disabled={emp.managerId === m.id}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold text-primary shrink-0">
                    {m.firstName[0]}
                    {m.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {m.firstName} {m.lastName}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {m.team}
                    </p>
                  </div>
                  {emp.managerId === m.id && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      current
                    </span>
                  )}
                </button>
              ))}
              {eligibleManagers.length === 0 && (
                <p className="text-xs text-muted-foreground italic px-2 py-1">
                  No other managers available.
                </p>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <button
        onClick={handleResend}
        disabled={!isApiMode || isMe || resendPending}
        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label={`Resend welcome email to ${emp.firstName} ${emp.lastName}`}
        title={isMe ? "Cannot resend to yourself" : !isApiMode ? "Not available in local mode" : "Resend welcome email"}
      >
        <Mail className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={handleToggleReminders}
        disabled={reminderPending}
        className={
          remindersOn
            ? "p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            : "p-1.5 rounded-md hover:bg-warning/10 text-warning disabled:opacity-30 disabled:cursor-not-allowed"
        }
        aria-label={`${remindersOn ? "Disable" : "Enable"} scheduled reminders for ${emp.firstName} ${emp.lastName}`}
        title={
          remindersOn
            ? "Scheduled reminders on — click to exempt"
            : "Exempt from scheduled reminders — click to re-enable"
        }
      >
        {remindersOn ? (
          <Bell className="h-3.5 w-3.5" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        onClick={() => onEdit(emp)}
        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
        aria-label={`Edit ${emp.firstName} ${emp.lastName}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onDelete(emp)}
        className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive/60 hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label={`Delete ${emp.firstName} ${emp.lastName}`}
        disabled={isMe}
        title={isMe ? "You cannot delete yourself" : undefined}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default EmployeeManagement;
