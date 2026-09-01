import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Search, Download, Mail, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { getReportingPeriod } from "cpi-work-allocation-shared";
import { useAllocations, MONTH_NAMES, AllocationStatus } from "@/contexts/AllocationsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useClientsConfig } from "@/contexts/ClientsConfigContext";
import { resolveEnhancementTag } from "cpi-work-allocation-shared";
import { api, ApiError } from "@/lib/apiClient";
import { ExportModal } from "@/components/ExportModal";
import {
  SendRemindersDialog,
  type DelinquentManager,
} from "@/components/SendRemindersDialog";
import {
  ExpandableTeamGrid,
  type TeamGroup,
  type EmployeeDetail,
} from "@/components/ExpandableTeamGrid";
import { EXPORT_GROUPING_SLUGS } from "@/lib/exports/types";
import { buildExportRows } from "@/lib/exports/buildRows";
import { exportToCsv } from "@/lib/exports/csv";
import { exportToXlsx } from "@/lib/exports/xlsx";
import { exportToPdf } from "@/lib/exports/pdf";
import type { ExportOptions } from "@/lib/exports/types";
import { isNonWorkingActivity } from "@/lib/leaveClassification";

/**
 * Company Master Overview — Finance / org-wide read-only view.
 *
 * Redesigned as an Expandable Master-Detail Grid: a minimalist KPI header
 * (Epic 1), Team/Manager parent rows (Epic 2), and an employee-allocation
 * drill-down inside each expanded team (Epic 3). Replaces the old separate
 * summary-cards + flat-table layout — the summary IS the parent row now and
 * the raw data is one click away.
 *
 * All derivations read from the real AllocationsContext store joined against
 * the employee directory, so employees with no record for the period surface
 * as "Not Submitted" / Blank.
 */

// One row in the flat master table. Employees with no allocation for
// the period produce a single "not submitted" row; employees with an
// allocation fan out to one row per activity.
type MasterRow =
  | {
      kind: "activity";
      key: string;
      employeeId: string;
      employeeName: string;
      team: string;
      managerName: string;
      managerId: string | null;
      status: AllocationStatus;
      workCategory: string;
      subCategory: string | null;
      workType: string;
      /** Resolved Enhancement — stored tag, else parsed from the description. */
      enhancement: string;
      client: string;
      description: string;
      percentage: number;
    }
  | {
      kind: "empty";
      key: string;
      employeeId: string;
      employeeName: string;
      team: string;
      managerName: string;
      managerId: string | null;
    };

// Reporting/Review view: the approval lifecycle runs in arrears, so this
// org-wide overview defaults to the PREVIOUS calendar month — the period
// Finance actually needs to act on — rather than the current month.
const REPORTING_PERIOD = getReportingPeriod();
const DEFAULT_YEAR = REPORTING_PERIOD.year;
const DEFAULT_MONTH = REPORTING_PERIOD.month;

/** Epic 1 — one flat, pastel-tinted metric in the Bento header. */
const BentoMetric = ({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone: "success" | "warning" | "destructive";
  hint?: string;
}) => {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : "text-destructive";
  const dotClass =
    tone === "success"
      ? "bg-success/15"
      : tone === "warning"
        ? "bg-warning/15"
        : "bg-destructive/15";
  return (
    <div className="flex min-w-[8rem] items-center gap-3 px-4">
      <span className={`h-9 w-1.5 rounded-full ${dotClass}`} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={`text-2xl font-bold leading-tight tabular-nums ${toneClass}`}>
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
};

const CompanyMasterOverview = () => {
  const { records } = useAllocations();
  const { getAllUsers } = useAuth();
  const { teams: configuredTeams, enhancements } = useClientsConfig();

  const [month, setMonth] = useState<string>(DEFAULT_MONTH);
  const [year, setYear] = useState<string>(DEFAULT_YEAR);
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterManager, setFilterManager] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  const allUsers = useMemo(
    // Only Employees and Managers show up in the directory view.
    // Finance users aren't subjects of allocation review — exclude any
    // user whose only role is Finance. Multi-role users (e.g.
    // [Finance, Employee]) STAY in the directory because they still
    // submit allocations as employees.
    () =>
      getAllUsers().filter(
        (u) => !(u.roles.length === 1 && u.roles[0] === "Finance"),
      ),
    [getAllUsers],
  );

  // Allocations for the selected period only. Scoped early so every
  // downstream derivation is automatically period-aware.
  const periodRecords = useMemo(
    () => records.filter((r) => r.month === month && r.year === year),
    [records, month, year],
  );

  // Manager dropdown — build from the union of seeded managers across
  // the period's records and the directory (so managers who supervise
  // teams with zero submissions still appear).
  // Guard against empty strings: Radix Select crashes if any <SelectItem>
  // receives value="" (reserved for the clear/placeholder state).
  const managersInScope = useMemo(() => {
    const names = new Set<string>();
    for (const r of periodRecords) if (r.managerName) names.add(r.managerName);
    for (const u of allUsers) if (u.managerName) names.add(u.managerName);
    return Array.from(names).sort();
  }, [periodRecords, allUsers]);

  // Team dropdown — prefer the configured taxonomy but union in any
  // "unknown" teams that appear in records (data drift safety).
  const teamsInScope = useMemo(() => {
    const s = new Set<string>(configuredTeams.filter(Boolean));
    for (const r of periodRecords) if (r.team) s.add(r.team);
    for (const u of allUsers) if (u.team) s.add(u.team);
    return Array.from(s).sort();
  }, [configuredTeams, periodRecords, allUsers]);

  /**
   * Flatten the period's records into per-activity rows, and append
   * "empty" rows for directory employees who didn't submit. The
   * employee-first iteration guarantees no employee is missing from
   * the view even if they've never touched the app.
   */
  const allRows = useMemo<MasterRow[]>(() => {
    const rows: MasterRow[] = [];
    const recordByEmployee = new Map(periodRecords.map((r) => [r.employeeId, r]));

    for (const user of allUsers) {
      const record = recordByEmployee.get(user.id);
      if (!record) {
        rows.push({
          kind: "empty",
          key: `empty:${user.id}`,
          employeeId: user.id,
          employeeName: `${user.firstName} ${user.lastName}`,
          team: user.team,
          managerName: user.managerName,
          managerId: user.managerId ?? null,
        });
        continue;
      }

      // Non-working time (leave / holiday) is excluded from this grid and
      // from the Excel/PDF export it feeds, using the SAME shared predicate
      // as the API's Finance CSV so the two can never disagree about one
      // employee-month. The underlying record is untouched — this filters
      // the SHEET, not the data.
      const isWorking = (
        streamCategory: string,
        activity: { subCategory?: string | null; workType: string },
      ) =>
        !isNonWorkingActivity({
          workCategory: streamCategory,
          subCategory: activity.subCategory ?? null,
          workType: activity.workType,
        });

      // Records with zero activities (edge case — empty Draft) still
      // render as a single row to show their status. Counting only WORKING
      // activities matters here: an employee whose whole month was leave
      // would otherwise pass this gate, emit no rows below, and vanish from
      // an org-wide compliance grid. They fall through to the "empty" row
      // instead, staying visible with their status intact.
      const totalActivities = record.streams.reduce(
        (sum, s) => sum + s.activities.filter((a) => isWorking(s.category, a)).length,
        0,
      );
      if (totalActivities === 0) {
        rows.push({
          kind: "empty",
          key: `noactivities:${record.id}`,
          employeeId: user.id,
          employeeName: record.employeeName,
          team: record.team,
          managerName: record.managerName,
          managerId: record.managerId ?? null,
        });
        continue;
      }

      for (const stream of record.streams) {
        for (const activity of stream.activities) {
          if (!isWorking(stream.category, activity)) continue;

          rows.push({
            kind: "activity",
            key: `${record.id}:${activity.id}`,
            employeeId: user.id,
            employeeName: record.employeeName,
            team: record.team,
            managerName: record.managerName,
            managerId: record.managerId ?? null,
            status: record.status,
            workCategory: activity.workCategory,
            subCategory: activity.subCategory ?? null,
            workType: activity.workType,
            // Same chain the API's Finance CSV uses (shared resolver), so the
            // Excel/PDF export and /api/finance-export can never report a
            // different Enhancement for the same row. Historical rows with no
            // stored tag still recover one from their description.
            enhancement: resolveEnhancementTag(activity, enhancements),
            client: activity.client,
            description: activity.description,
            percentage: activity.percentage,
          });
        }
      }
    }

    return rows;
  }, [allUsers, periodRecords, enhancements]);

  /**
   * Period-wide Team rollup, keyed strictly by team name.
   * Intentionally driven by the period only (NOT the team/manager/status/
   * search filters) so the global KPI header stays a stable org-wide
   * compliance picture.
   *
   * "Approved %" is approved-over-total-headcount (everyone in the group,
   * including people who never started) — the compliance number Finance
   * reports on.
   */
  const periodSummaries = useMemo(() => {
    const recordByEmployee = new Map(periodRecords.map((r) => [r.employeeId, r]));
    const groups = new Map<
      string,
      { team: string; total: number; approved: number; notStarted: number; approvedPct: number }
    >();

    for (const user of allUsers) {
      const record = recordByEmployee.get(user.id);
      const team = record?.team ?? user.team;

      let g = groups.get(team);
      if (!g) {
        g = { team, total: 0, approved: 0, notStarted: 0, approvedPct: 0 };
        groups.set(team, g);
      }
      g.total += 1;
      if (!record) g.notStarted += 1;
      else if (record.status === "Approved") g.approved += 1;
    }

    const arr = Array.from(groups.values());
    for (const g of arr) {
      g.approvedPct = g.total > 0 ? Math.round((g.approved / g.total) * 100) : 0;
    }
    return arr;
  }, [allUsers, periodRecords]);

  /**
   * Epic 1 — globally aggregated KPIs for the Bento header. Period-wide and
   * filter-independent (see periodSummaries) so Finance always sees the true
   * company picture regardless of how they've drilled the grid below.
   */
  const companyKpis = useMemo(() => {
    let approved = 0;
    let blank = 0;
    let total = 0;
    let pendingTeams = 0;
    for (const s of periodSummaries) {
      blank += s.notStarted;
      total += s.total;
      if (s.approvedPct < 100) pendingTeams += 1;
    }
    const totalTeams = periodSummaries.length;
    return {
      completedTeams: totalTeams - pendingTeams,
      totalTeams,
      pendingTeams,
      submittedEmployees: total - blank,
      totalEmployees: total,
    };
  }, [periodSummaries]);

  /**
   * Epic 2 — managers whose direct reports are NOT yet 100% approved.
   * Derived directly from the employee directory + period records so it
   * remains correct with strict single-key team grouping. Managers at the
   * top of the reporting chain (no managerId) can't be emailed.
   */
  const delinquentManagers = useMemo<DelinquentManager[]>(() => {
    const recordByEmployee = new Map(periodRecords.map((r) => [r.employeeId, r]));
    const byManager = new Map<string, DelinquentManager>();

    for (const user of allUsers) {
      const record = recordByEmployee.get(user.id);
      const managerId = (record?.managerId ?? user.managerId) || null;
      if (!managerId) continue;
      const managerName = record?.managerName || user.managerName || "Unassigned";
      const team = record?.team ?? user.team;

      let m = byManager.get(managerId);
      if (!m) {
        m = { managerId, managerName, teams: [], total: 0, outstanding: 0 };
        byManager.set(managerId, m);
      }
      if (!m.teams.includes(team)) m.teams.push(team);
      m.total += 1;
      if (record?.status !== "Approved") m.outstanding += 1;
    }

    return Array.from(byManager.values())
      .filter((m) => m.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [allUsers, periodRecords]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (filterTeam !== "all" && row.team !== filterTeam) return false;
      if (filterManager !== "all" && row.managerName !== filterManager)
        return false;
      if (filterStatus !== "all") {
        const rowStatus = row.kind === "activity" ? row.status : "Not Submitted";
        if (rowStatus !== filterStatus) return false;
      }
      if (q) {
        const matchesEmployee =
          row.employeeName.toLowerCase().includes(q) ||
          row.employeeId.toLowerCase().includes(q);
        const matchesClassification =
          row.kind === "activity" &&
          (row.workCategory.toLowerCase().includes(q) ||
            (row.subCategory?.toLowerCase().includes(q) ?? false) ||
            row.workType.toLowerCase().includes(q) ||
            row.client.toLowerCase().includes(q));
        if (!matchesEmployee && !matchesClassification) {
          return false;
        }
      }
      return true;
    });
  }, [allRows, filterTeam, filterManager, filterStatus, search]);

  /**
   * Epic 2 + 3 — group the filtered flat rows into Team parents with their
   * employees nested for the drill-down. Grouped strictly by team name so
   * employees with different direct managers are never split into separate
   * parent rows. Each EmployeeDetail carries its own managerId/managerName
   * so child rows can fire targeted reminders individually (Epic 2).
   */
  const teamGroups = useMemo<TeamGroup[]>(() => {
    const groups = new Map<
      string,
      { team: string; employees: Map<string, EmployeeDetail> }
    >();

    for (const row of filtered) {
      let g = groups.get(row.team);
      if (!g) {
        g = { team: row.team, employees: new Map() };
        groups.set(row.team, g);
      }
      let emp = g.employees.get(row.employeeId);
      if (!emp) {
        emp = {
          employeeId: row.employeeId,
          employeeName: row.employeeName,
          managerName: row.managerName,
          managerId: row.managerId,
          status: row.kind === "activity" ? row.status : "Not Submitted",
          activities: [],
        };
        g.employees.set(row.employeeId, emp);
      }
      if (row.kind === "activity") {
        emp.status = row.status; // uniform per record; last write is fine
        emp.activities.push({
          key: row.key,
          workCategory: row.workCategory,
          subCategory: row.subCategory,
          workType: row.workType,
          client: row.client,
          description: row.description,
          percentage: row.percentage,
        });
      }
    }

    const result: TeamGroup[] = [];
    for (const [, g] of groups) {
      const employees = Array.from(g.employees.values()).sort((a, b) =>
        a.employeeName.localeCompare(b.employeeName),
      );
      let approved = 0;
      let pendingReview = 0;
      let needsRevision = 0;
      let draft = 0;
      let notStarted = 0;
      for (const e of employees) {
        switch (e.status) {
          case "Approved":       approved++; break;
          case "Pending Review": pendingReview++; break;
          case "Needs Revision": needsRevision++; break;
          case "Draft":          draft++; break;
          case "Not Submitted":  notStarted++; break;
        }
      }
      const total = employees.length;
      result.push({
        key: g.team,
        team: g.team,
        total,
        approved,
        pendingReview,
        needsRevision,
        draft,
        notStarted,
        approvedPct: total > 0 ? Math.round((approved / total) * 100) : 0,
        employees,
      });
    }
    // Lowest compliance first — the teams needing attention float to the top.
    result.sort(
      (a, b) => a.approvedPct - b.approvedPct || a.team.localeCompare(b.team),
    );
    return result;
  }, [filtered]);

  // ---- Export ------------------------------------------------------

  const [exportOpen, setExportOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);

  const filtersSummary = useMemo(() => {
    const bits: string[] = [];
    bits.push(filterTeam === "all" ? "All teams" : filterTeam);
    bits.push(filterManager === "all" ? "All managers" : filterManager);
    bits.push(filterStatus === "all" ? "All statuses" : filterStatus);
    if (search.trim()) bits.push(`search: "${search.trim()}"`);
    return bits.join(" · ");
  }, [filterTeam, filterManager, filterStatus, search]);

  const scopeLabel = useMemo(() => {
    const base = `${month} ${year}`;
    const mods: string[] = [];
    if (filterTeam !== "all") mods.push(filterTeam);
    if (filterManager !== "all") mods.push(filterManager);
    return mods.length > 0 ? `${base} · ${mods.join(" · ")}` : base;
  }, [month, year, filterTeam, filterManager]);

  const scopeSlug = useMemo(() => {
    return scopeLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }, [scopeLabel]);

  const exportableCount = useMemo(
    () => filtered.filter((r) => r.kind === "activity").length,
    [filtered],
  );

  const handleExport = async (options: ExportOptions) => {
    const rows = buildExportRows(filtered, options.grouping, options.columns);
    try {
      let blob: Blob;
      let extension: string;
      switch (options.format) {
        case "csv":
          blob = exportToCsv(options, rows);
          extension = "csv";
          break;
        case "xlsx":
          blob = await exportToXlsx(options, rows);
          extension = "xlsx";
          break;
        case "pdf":
          blob = await exportToPdf(options, rows);
          extension = "pdf";
          break;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cpi-allocations-${options.scopeSlug}-${
        EXPORT_GROUPING_SLUGS[options.grouping]
      }.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${exportableCount} ${
          exportableCount === 1 ? "row" : "rows"
        } as ${options.format.toUpperCase()}.`,
      );
      setExportOpen(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown export error";
      toast.error(`Export failed: ${message}`);
    }
  };

  // ---- Inline per-employee reminder (Epic 2) -----------------------
  // Fires a targeted reminder to a specific manager from a child row.
  // Reuses the same endpoint as the bulk dialog with a one-id array.
  const handleRemindManager = async (managerId: string, managerName: string) => {
    try {
      const result = await api.notifications.manualReminder(
        [managerId],
        month,
        year,
      );
      if (result.sent.length > 0) {
        toast.success(
          `Reminder sent to ${managerName} for ${month} ${year}.`,
        );
      } else {
        toast.warning(
          `Couldn't remind ${managerName} — no email on file.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? typeof err.body === "object" &&
            err.body !== null &&
            "error" in err.body
            ? String((err.body as { error: unknown }).error)
            : `Request failed (${err.status})`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      toast.error(`Could not send reminder: ${message}`);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 overflow-y-auto h-full min-h-0">
      {/* Title */}
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Master Overview
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold text-foreground/80">
              Cross-team work allocation
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-0.5 text-xs font-bold text-primary ring-1 ring-primary/20">
              <CalendarRange className="h-3 w-3" />
              {month} {year}
            </span>
          </div>
        </div>
      </div>

      {/* Epic 1 — Minimalist Bento KPI header */}
      <div className="flex flex-wrap items-center gap-y-3 rounded-xl bg-card py-3 shadow-sm ring-1 ring-border/60">
        <div className="flex flex-1 flex-wrap items-center divide-x divide-border/60">
          <BentoMetric
            label="Completed"
            value={companyKpis.completedTeams}
            tone="success"
            hint="teams fully approved this period"
          />
          <BentoMetric
            label="Pending Teams"
            value={companyKpis.pendingTeams}
            tone="warning"
            hint="not yet fully approved"
          />
          <BentoMetric
            label="Submitted"
            value={`${companyKpis.submittedEmployees}/${companyKpis.totalEmployees}`}
            tone={companyKpis.submittedEmployees === companyKpis.totalEmployees ? "success" : "destructive"}
            hint="employees submitted this period"
          />
        </div>
        <div className="ml-auto flex items-center gap-2 px-4">
          <Button
            variant="outline"
            onClick={() => setRemindersOpen(true)}
            className="gap-2"
            disabled={delinquentManagers.length === 0}
            title={
              delinquentManagers.length === 0
                ? `Every team is fully approved for ${month} ${year}`
                : undefined
            }
          >
            <Mail className="h-4 w-4" /> Send Reminders
            {delinquentManagers.length > 0 ? ` (${delinquentManagers.length})` : ""}
          </Button>
          <Button
            onClick={() => setExportOpen(true)}
            className="gap-2"
            disabled={exportableCount === 0}
          >
            <Download className="h-4 w-4" /> Export…
          </Button>
        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filtersSummary={filtersSummary}
        scopeLabel={scopeLabel}
        scopeSlug={scopeSlug}
        rowCount={exportableCount}
        onExport={handleExport}
      />

      <SendRemindersDialog
        open={remindersOpen}
        onClose={() => setRemindersOpen(false)}
        managers={delinquentManagers}
        month={month}
        year={year}
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-3">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["2024", "2025", "2026"].map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterTeam} onValueChange={setFilterTeam}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              {teamsInScope.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterManager} onValueChange={setFilterManager}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Filter by manager" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Managers</SelectItem>
              {managersInScope.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Pending Review">Pending Review</SelectItem>
              <SelectItem value="Needs Revision">Needs Revision</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Not Submitted">Not Submitted</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employee, category, client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Epic 2 + 3 — Expandable Team grid with employee drill-down */}
      <ExpandableTeamGrid
        groups={teamGroups}
        onRemind={handleRemindManager}
        emptyMessage="No teams match the current filters."
      />
    </div>
  );
};

export default CompanyMasterOverview;
