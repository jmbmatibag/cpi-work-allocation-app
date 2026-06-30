import { Fragment, useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  type ExpandedState,
  type PaginationState,
  type Row,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/TablePagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Mail,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AllocationStatus } from "@/contexts/AllocationsContext";

export type EmployeeStatus = AllocationStatus | "Not Submitted";

export interface DetailActivity {
  key: string;
  workCategory: string;
  subCategory: string | null;
  workType: string;
  client: string;
  description: string;
  percentage: number;
}

export interface EmployeeDetail {
  employeeId: string;
  employeeName: string;
  managerName: string;
  managerId: string | null;
  status: EmployeeStatus;
  activities: DetailActivity[];
}

export interface TeamGroup {
  key: string;
  team: string;
  total: number;
  approved: number;
  pendingReview: number;
  needsRevision: number;
  draft: number;
  notStarted: number;
  approvedPct: number;
  employees: EmployeeDetail[];
}

const PARENT_COL_COUNT = 4;

const statusBadgeClass = (s: EmployeeStatus): string => {
  switch (s) {
    case "Draft":          return "bg-muted text-muted-foreground border-0";
    case "Pending Review": return "bg-warning/10 text-warning border-0";
    case "Needs Revision": return "bg-destructive/10 text-destructive border-0";
    case "Approved":       return "bg-success/10 text-success border-0";
    case "Not Submitted":  return "bg-destructive/5 text-destructive/80 border-0";
  }
};

const CountChip = ({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className: string;
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      className,
    )}
  >
    <span className="tabular-nums font-semibold">{count}</span>
    <span className="font-normal opacity-75">{label}</span>
  </span>
);

/** Picks 1–2 initials from a full name (e.g. "Venus Jameel Salud" → "VS"). */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** workCategory with the highest summed % for an employee; "—" if no activities. */
function computePrimaryFocus(activities: DetailActivity[]): string {
  if (activities.length === 0) return "—";
  const totals = new Map<string, number>();
  for (const a of activities) {
    totals.set(a.workCategory, (totals.get(a.workCategory) ?? 0) + a.percentage);
  }
  let best = "";
  let bestPct = -1;
  for (const [cat, pct] of totals) {
    if (pct > bestPct) { bestPct = pct; best = cat; }
  }
  return best || "—";
}

// ─── Palette helpers so conditional class names are complete strings ──────────
function managerRowBg(allApproved: boolean, allNotSubmitted: boolean): string {
  if (allApproved) return "bg-success/[0.06] hover:bg-success/[0.1]";
  if (allNotSubmitted) return "bg-destructive/[0.04] hover:bg-destructive/[0.07]";
  return "bg-primary/[0.04] hover:bg-primary/[0.07]";
}
function accentStripColor(allApproved: boolean, allNotSubmitted: boolean, hasPending: boolean): string {
  if (allApproved) return "bg-success";
  if (allNotSubmitted) return "bg-destructive/50";
  if (hasPending) return "bg-warning";
  return "bg-primary/40";
}
function avatarColors(allApproved: boolean, allNotSubmitted: boolean): string {
  if (allApproved) return "bg-success/20 text-success ring-success/20";
  if (allNotSubmitted) return "bg-destructive/15 text-destructive ring-destructive/15";
  return "bg-primary/15 text-primary ring-primary/15";
}

/**
 * Drill-down for one expanded Team row.
 *
 * Renders Manager accordion rows (collapsed by default). Each row shows:
 * accent strip · chevron · initials avatar · name / direct-report count ·
 * status chips · mail icon.
 *
 * Employee columns: Employee | Primary Focus | Entries | Total % | Status
 */
const TeamDetail = ({
  group,
  onRemind,
  reminding,
}: {
  group: TeamGroup;
  onRemind: (managerId: string, managerName: string) => void;
  reminding: Set<string>;
}) => {
  const [expandedManagerIds, setExpandedManagerIds] = useState<Set<string>>(
    new Set(),
  );

  const managerGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { managerId: string | null; managerName: string; employees: EmployeeDetail[] }
    >();

    for (const emp of group.employees) {
      const key = emp.managerId ?? emp.managerName ?? "Unassigned";
      if (!grouped.has(key)) {
        grouped.set(key, {
          managerId: emp.managerId,
          managerName: emp.managerName || "Unassigned",
          employees: [],
        });
      }
      grouped.get(key)!.employees.push(emp);
    }

    return Array.from(grouped.entries())
      .sort(([, a], [, b]) => a.managerName.localeCompare(b.managerName))
      .map(([key, grp]) => {
        let approved = 0, pendingReview = 0, needsRevision = 0, draft = 0, notSubmitted = 0;
        for (const e of grp.employees) {
          switch (e.status) {
            case "Approved":       approved++;       break;
            case "Pending Review": pendingReview++;  break;
            case "Needs Revision": needsRevision++;  break;
            case "Draft":          draft++;          break;
            case "Not Submitted":  notSubmitted++;   break;
          }
        }
        return {
          key,
          managerId: grp.managerId,
          managerName: grp.managerName,
          employees: grp.employees,
          approved,
          pendingReview,
          needsRevision,
          draft,
          notSubmitted,
          allApproved: grp.employees.every((e) => e.status === "Approved"),
          allNotSubmitted: grp.employees.every((e) => e.status === "Not Submitted"),
        };
      });
  }, [group.employees]);

  const toggleManager = (key: string) =>
    setExpandedManagerIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (group.employees.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No matching allocations for this team under the current filters.
      </div>
    );
  }

  const anyExpanded = expandedManagerIds.size > 0;

  return (
    <Table>
      {anyExpanded && (
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border/50">
            <TableHead className="h-8 text-xs font-semibold text-muted-foreground/80">Employee</TableHead>
            <TableHead className="h-8 text-xs font-semibold text-muted-foreground/80">Primary Focus</TableHead>
            <TableHead className="h-8 text-center text-xs font-semibold text-muted-foreground/80">Entries</TableHead>
            <TableHead className="h-8 text-right text-xs font-semibold text-muted-foreground/80">Total %</TableHead>
            <TableHead className="h-8 text-xs font-semibold text-muted-foreground/80">Status</TableHead>
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {managerGroups.map((mgr) => {
          const isExpanded = expandedManagerIds.has(mgr.key);
          const busy = mgr.managerId ? reminding.has(mgr.managerId) : false;
          const remindDisabled = !mgr.managerId || mgr.allApproved || busy;
          const sortedEmployees = [...mgr.employees].sort((a, b) =>
            a.employeeName.localeCompare(b.employeeName),
          );

          return (
            <Fragment key={mgr.key}>
              {/* ── Manager Accordion Row ── */}
              <TableRow
                className={cn(
                  "cursor-pointer border-t border-border/30 transition-colors duration-150",
                  managerRowBg(mgr.allApproved, mgr.allNotSubmitted),
                )}
                onClick={() => toggleManager(mgr.key)}
              >
                <TableCell colSpan={5} className="py-0 pl-0 pr-4">
                  <div className="flex items-center gap-3 py-2.5">
                    {/* Status accent strip */}
                    <span
                      className={cn(
                        "ml-1 h-9 w-1 shrink-0 rounded-full",
                        accentStripColor(mgr.allApproved, mgr.allNotSubmitted, mgr.pendingReview > 0),
                      )}
                    />

                    {/* Chevron */}
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200",
                        isExpanded && "rotate-90 text-muted-foreground",
                      )}
                    />

                    {/* Initials avatar */}
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-2",
                        avatarColors(mgr.allApproved, mgr.allNotSubmitted),
                      )}
                    >
                      {getInitials(mgr.managerName)}
                    </div>

                    {/* Name + report count */}
                    <div className="min-w-[10rem] shrink-0">
                      <p className="text-sm font-semibold leading-tight text-foreground">
                        {mgr.managerName}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-none text-muted-foreground">
                        {mgr.employees.length}{" "}
                        {mgr.employees.length === 1 ? "direct report" : "direct reports"}
                      </p>
                    </div>

                    {/* Vertical divider */}
                    <span className="h-8 w-px shrink-0 bg-border/50" />

                    {/* Status chips */}
                    <div className="flex flex-1 flex-wrap items-center gap-1.5">
                      {mgr.approved > 0 && (
                        <CountChip count={mgr.approved} label="Approved" className="bg-success/10 text-success" />
                      )}
                      {mgr.pendingReview > 0 && (
                        <CountChip count={mgr.pendingReview} label="Pending" className="bg-warning/10 text-warning" />
                      )}
                      {mgr.needsRevision > 0 && (
                        <CountChip count={mgr.needsRevision} label="Revision" className="bg-destructive/10 text-destructive" />
                      )}
                      {mgr.draft > 0 && (
                        <CountChip count={mgr.draft} label="Draft" className="bg-muted text-muted-foreground" />
                      )}
                      {mgr.notSubmitted > 0 && (
                        <CountChip count={mgr.notSubmitted} label="Not Submitted" className="bg-destructive/5 text-destructive/70" />
                      )}
                    </div>

                    {/* Mail CTA — pinned far right */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-7 w-7 shrink-0 rounded-full transition-colors",
                        remindDisabled
                          ? "text-muted-foreground/30"
                          : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                      )}
                      disabled={remindDisabled}
                      title={
                        !mgr.managerId
                          ? "No manager on file"
                          : mgr.allApproved
                            ? "All employees are approved"
                            : `Send reminder to ${mgr.managerName}`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mgr.managerId) onRemind(mgr.managerId, mgr.managerName);
                      }}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Mail className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>

              {/* ── Employee Child Rows ── */}
              {isExpanded &&
                sortedEmployees.map((emp) => {
                  const totalEntries = emp.activities.length;
                  const totalPct = emp.activities.reduce((sum, a) => sum + a.percentage, 0);
                  const notSubmitted = emp.status === "Not Submitted";
                  const primaryFocus = computePrimaryFocus(emp.activities);
                  return (
                    <TableRow
                      key={emp.employeeId}
                      className="bg-background/60 hover:bg-muted/30 border-t border-border/20"
                    >
                      <TableCell className="pl-12 font-medium text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                          {emp.employeeName}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {primaryFocus}
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">
                        {notSubmitted ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          <span className="font-medium">{totalEntries}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-primary">
                        {notSubmitted ? (
                          <span className="font-normal text-muted-foreground/50">—</span>
                        ) : (
                          `${totalPct.toFixed(2)}%`
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusBadgeClass(emp.status)}>
                          {emp.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
};

interface ExpandableTeamGridProps {
  groups: TeamGroup[];
  onRemind: (managerId: string, managerName: string) => Promise<void>;
  emptyMessage?: string;
  pageSize?: number;
}

export const ExpandableTeamGrid = ({
  groups,
  onRemind,
  emptyMessage = "No teams match the current filters.",
  pageSize = 10,
}: ExpandableTeamGridProps) => {
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "approvedPct", desc: false },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const [reminding, setReminding] = useState<Set<string>>(new Set());

  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [groups.length]);

  const handleRemind = async (managerId: string, managerName: string) => {
    setReminding((prev) => new Set(prev).add(managerId));
    try {
      await onRemind(managerId, managerName);
    } finally {
      setReminding((prev) => {
        const next = new Set(prev);
        next.delete(managerId);
        return next;
      });
    }
  };

  const columns: ColumnDef<TeamGroup>[] = [
    {
      id: "expander",
      header: () => null,
      enableSorting: false,
      size: 40,
      cell: ({ row }) => (
        <button
          type="button"
          aria-label={row.getIsExpanded() ? "Collapse team" : "Expand team"}
          onClick={(e) => {
            e.stopPropagation();
            row.toggleExpanded();
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              row.getIsExpanded() && "rotate-90",
            )}
          />
        </button>
      ),
    },
    {
      accessorKey: "team",
      header: "Team",
      cell: ({ row }) => (
        <span className="font-semibold text-foreground">{row.original.team}</span>
      ),
    },
    {
      accessorKey: "approvedPct",
      header: "Overall Progress",
      size: 220,
      cell: ({ row }) => {
        const g = row.original;
        return (
          <div className="flex items-center gap-3 pr-2">
            <Progress value={g.approvedPct} className="h-2 flex-1" />
            <span
              className={cn(
                "w-10 shrink-0 text-right text-sm font-semibold tabular-nums",
                g.approvedPct >= 100 ? "text-success" : "text-foreground",
              )}
            >
              {g.approvedPct}%
            </span>
          </div>
        );
      },
    },
    {
      id: "breakdown",
      header: "Status Breakdown",
      enableSorting: false,
      cell: ({ row }) => {
        const g = row.original;
        return (
          <div className="flex flex-wrap gap-1.5">
            <CountChip count={g.approved} label="Approved" className="bg-success/10 text-success" />
            {g.pendingReview > 0 && (
              <CountChip count={g.pendingReview} label="Pending" className="bg-warning/10 text-warning" />
            )}
            {g.needsRevision > 0 && (
              <CountChip count={g.needsRevision} label="Revision" className="bg-destructive/10 text-destructive" />
            )}
            {g.draft > 0 && (
              <CountChip count={g.draft} label="Draft" className="bg-muted text-muted-foreground" />
            )}
            {g.notStarted > 0 && (
              <CountChip count={g.notStarted} label="Not Submitted" className="bg-destructive/5 text-destructive/70" />
            )}
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: groups,
    columns,
    state: { expanded, sorting, pagination },
    onExpandedChange: setExpanded,
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    getRowId: (g) => g.key,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-0">
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      style={
                        header.column.columnDef.size !== undefined
                          ? { width: header.column.columnDef.size }
                          : undefined
                      }
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded px-0.5 -ml-0.5 transition-colors hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-primary" />
                          ) : sorted === "desc" ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-30" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={PARENT_COL_COUNT}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row: Row<TeamGroup>) => (
                <Fragment key={row.id}>
                  <TableRow
                    data-state={row.getIsExpanded() ? "expanded" : undefined}
                    className="cursor-pointer hover:bg-muted/40 data-[state=expanded]:bg-muted/30"
                    onClick={() => row.toggleExpanded()}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={PARENT_COL_COUNT} className="p-0">
                        <div className="animate-fade-in border-l-2 border-primary/30 bg-muted/20 px-3 py-2">
                          <TeamDetail
                            group={row.original}
                            onRemind={handleRemind}
                            reminding={reminding}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={pagination.pageIndex + 1}
        pageSize={pagination.pageSize}
        totalItems={groups.length}
        onPageChange={(p) =>
          setPagination((prev) => ({ ...prev, pageIndex: p - 1 }))
        }
      />
    </div>
  );
};
