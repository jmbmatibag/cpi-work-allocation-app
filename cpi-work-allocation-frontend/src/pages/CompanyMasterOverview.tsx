import { useState, useMemo, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, Search, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { useAllocations, MONTH_NAMES, AllocationStatus } from "@/contexts/AllocationsContext";
import { useAuth, AppUser } from "@/contexts/AuthContext";
import { useClientsConfig } from "@/contexts/ClientsConfigContext";
import { ExportModal } from "@/components/ExportModal";
import { buildExportRows } from "@/lib/exports/buildRows";
import { exportToCsv } from "@/lib/exports/csv";
import { exportToXlsx } from "@/lib/exports/xlsx";
import { exportToPdf } from "@/lib/exports/pdf";
import type { ExportOptions } from "@/lib/exports/types";

/**
 * Company Master Overview — Finance / org-wide read-only view.
 *
 * Shows every activity every employee submitted for the selected
 * month/year, joined against the employee directory so employees
 * with no record in that period show up as "Not Submitted".
 *
 * Previously this page read from a hardcoded mockData.dashboardEmployees
 * array that had no relationship to what was actually in
 * AllocationsContext. Finance users saw made-up data. Phase I wires
 * it to the real allocation store plus the employee directory.
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
      status: AllocationStatus;
      workCategory: string;
      subCategory: string | null;
      workType: string;
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
    };

const statusBadgeClass = (s: AllocationStatus): string => {
  switch (s) {
    case "Draft":          return "bg-muted text-muted-foreground";
    case "Pending Review": return "bg-warning/10 text-warning";
    case "Needs Revision": return "bg-destructive/10 text-destructive";
    case "Approved":       return "bg-success/10 text-success";
  }
};

const CURRENT_YEAR = new Date().getFullYear().toString();
const CURRENT_MONTH = MONTH_NAMES[new Date().getMonth()];

const CompanyMasterOverview = () => {
  const { records } = useAllocations();
  const { getAllUsers } = useAuth();
  const { teams: configuredTeams } = useClientsConfig();

  const [month, setMonth] = useState<string>(CURRENT_MONTH);
  const [year, setYear] = useState<string>(CURRENT_YEAR);
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterManager, setFilterManager] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 10;

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
        });
        continue;
      }

      // Records with zero activities (edge case — empty Draft) still
      // render as a single row to show their status.
      const totalActivities = record.streams.reduce(
        (sum, s) => sum + s.activities.length,
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
        });
        continue;
      }

      for (const stream of record.streams) {
        for (const activity of stream.activities) {
          rows.push({
            kind: "activity",
            key: `${record.id}:${activity.id}`,
            employeeId: user.id,
            employeeName: record.employeeName,
            team: record.team,
            managerName: record.managerName,
            status: record.status,
            workCategory: activity.workCategory,
            subCategory: activity.subCategory ?? null,
            workType: activity.workType,
            client: activity.client,
            description: activity.description,
            percentage: activity.percentage,
          });
        }
      }
    }

    return rows;
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
        // Phase P: also let users search by category / sub cat / work
        // type / client for activity rows. Empty rows only match by
        // employee (they have no classification).
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

  useEffect(() => { setPage(1); }, [filterTeam, filterManager, filterStatus, search, month, year]);

  // When "All Statuses" is selected, hide "Not Submitted" rows from the table.
  // They still count toward KPIs so the summary cards stay accurate.
  // Explicitly filtering by "Not Submitted" in the dropdown still shows them.
  const visibleRows = useMemo(
    () =>
      filterStatus === "all"
        ? filtered.filter((r) => r.kind !== "empty")
        : filtered,
    [filtered, filterStatus],
  );

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const paginated = visibleRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // KPIs — count distinct employees, not rows (employees with many
  // activities shouldn't inflate the counts).
  const kpis = useMemo(() => {
    const byEmployee = new Map<string, MasterRow>();
    for (const row of filtered) {
      // First row wins — activity rows come before empty rows in the
      // iteration, so if any activity exists for an employee we keep
      // that as the representative.
      if (!byEmployee.has(row.employeeId)) byEmployee.set(row.employeeId, row);
    }
    let approved = 0;
    let pending = 0;
    let notSubmitted = 0;
    for (const row of byEmployee.values()) {
      if (row.kind === "empty") notSubmitted++;
      else if (row.status === "Approved") approved++;
      else if (row.status === "Pending Review") pending++;
    }
    const activityRows = filtered.filter((r) => r.kind === "activity").length;
    const teamsRepresented = new Set(filtered.map((r) => r.team)).size;
    return {
      totalEmployees: byEmployee.size,
      approved,
      pending,
      notSubmitted,
      activityRows,
      teamsRepresented,
    };
  }, [filtered]);

  // ---- Export ------------------------------------------------------

  const [exportOpen, setExportOpen] = useState(false);

  // Human-readable filter summary for the modal preview + export
  // document title block. "All teams · All managers · All statuses"
  // when nothing is filtered; collapses to just the active ones
  // when filters are set.
  const filtersSummary = useMemo(() => {
    const bits: string[] = [];
    bits.push(filterTeam === "all" ? "All teams" : filterTeam);
    bits.push(filterManager === "all" ? "All managers" : filterManager);
    bits.push(filterStatus === "all" ? "All statuses" : filterStatus);
    if (search.trim()) bits.push(`search: "${search.trim()}"`);
    return bits.join(" · ");
  }, [filterTeam, filterManager, filterStatus, search]);

  // Scope label for the document title. "Apr 2026" normally; add
  // a team/manager/search modifier when filters are narrow enough.
  const scopeLabel = useMemo(() => {
    const base = `${month} ${year}`;
    const mods: string[] = [];
    if (filterTeam !== "all") mods.push(filterTeam);
    if (filterManager !== "all") mods.push(filterManager);
    return mods.length > 0 ? `${base} · ${mods.join(" · ")}` : base;
  }, [month, year, filterTeam, filterManager]);

  // Filename-safe slug.
  const scopeSlug = useMemo(() => {
    return scopeLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }, [scopeLabel]);

  // Count of activity rows that will be exported (empty rows are
  // dropped by buildExportRows).
  const exportableCount = useMemo(
    () => filtered.filter((r) => r.kind === "activity").length,
    [filtered],
  );

  // Dispatch to the right writer based on format, trigger download.
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
      a.download = `cpi-allocations-${options.scopeSlug}.${extension}`;
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

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Master Overview
            </h1>
            <p className="text-sm text-muted-foreground">
              Cross-team work allocation for {month} {year}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => setExportOpen(true)}
          className="gap-2"
          disabled={exportableCount === 0}
        >
          <Download className="h-4 w-4" /> Export…
        </Button>
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

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-success">
              {kpis.approved} <span className="text-base text-muted-foreground font-normal">/ {kpis.totalEmployees}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-warning">{kpis.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Not Submitted</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">{kpis.notSubmitted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Activities</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{kpis.activityRows}</p>
            <p className="text-xs text-muted-foreground">
              across {kpis.teamsRepresented} {kpis.teamsRepresented === 1 ? "team" : "teams"}
            </p>
          </CardContent>
        </Card>
      </div>

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
              placeholder="Search employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Master Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            All Allocations · {month} {year}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Sub Category</TableHead>
                <TableHead>Work Type</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    No results for the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((row) => {
                  if (row.kind === "empty") {
                    return (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.employeeName}</TableCell>
                        <TableCell>{row.team}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.managerName}
                        </TableCell>
                        <TableCell colSpan={6} className="text-sm text-muted-foreground italic">
                          Not submitted for {month} {year}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-destructive border-destructive/30">
                            Not Submitted
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">{row.employeeName}</TableCell>
                      <TableCell>{row.team}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.managerName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.workCategory}</Badge>
                      </TableCell>
                      <TableCell>
                        {row.subCategory ? (
                          <span
                            className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              background: "hsl(var(--primary-pastel))",
                              color: "hsl(var(--primary))",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {row.subCategory}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{row.workType}</TableCell>
                      <TableCell className="text-sm">{row.client}</TableCell>
                      <TableCell className="text-sm max-w-[280px] truncate" title={row.description}>
                        {row.description}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary tabular-nums">
                        {row.percentage.toFixed(2)}%
                      </TableCell>
                      <TableCell>
                        <Badge className={statusBadgeClass(row.status)}>
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} rows
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === "…" ? (
                      <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground text-sm">…</span>
                    ) : (
                      <Button
                        key={p}
                        variant={page === p ? "default" : "outline"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setPage(p as number)}
                      >
                        {p}
                      </Button>
                    )
                  )}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CompanyMasterOverview;
