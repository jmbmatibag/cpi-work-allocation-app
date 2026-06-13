import { useState, useMemo, useEffect } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAllocations,
  AllocationStatus,
} from "@/contexts/AllocationsContext";
import { useNotifications } from "@/contexts/NotificationsContext";
import { useClientsConfig } from "@/contexts/ClientsConfigContext";
import { useJournal } from "@/contexts/JournalContext";
import type { JournalEntry } from "@/contexts/JournalContext";
import { deriveBlocksFromContent } from "@/lib/journalAggregation";
import { useEmployees } from "@/contexts/EmployeesContext";
import type { Employee } from "@/contexts/EmployeesContext";
import type { WorkStreamData, ActivityData } from "@/components/Workspace";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  Flag,
  X,
  Pencil,
  Trash2,
  History,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CalendarDays,
  AtSign,
  Hash,
  Users,
  FileEdit,
} from "lucide-react";
import { toast } from "sonner";
import { TablePagination } from "@/components/ui/TablePagination";
import { TeamAnalytics } from "./TeamAnalytics";

const ALL_MONTHS = "all";

const MONTHS = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December",
];

const statusColor: Record<AllocationStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  "Pending Review": "bg-warning/10 text-warning",
  Approved: "bg-success/10 text-success",
  "Needs Revision": "bg-destructive/10 text-destructive",
};

// --- Submissions table data-grid types & helpers ---------------------
//
// Sorting on `period` is by chronological order, not alphabetical month
// name — "April 2025" must come before "January 2026". The MONTH_INDEX
// map plus year gives a single comparable integer (year * 12 + month).
//
// `submitted` sort treats nulls (Draft records that haven't been
// submitted yet) as always-last regardless of asc/desc direction —
// the more useful behaviour than letting them swap ends.

type SortKey = "employee" | "period" | "status" | "submitted" | "streams";
type SortDirection = "asc" | "desc";

const SUBMISSIONS_PAGE_SIZE = 10;

const MONTH_INDEX: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3,
  May: 4, June: 5, July: 6, August: 7,
  September: 8, October: 9, November: 10, December: 11,
};

const periodKey = (r: { month: string; year: number }): number =>
  r.year * 12 + (MONTH_INDEX[r.month] ?? 0);

const sumStreamTotals = (streams: WorkStreamData[]): number =>
  streams.reduce(
    (sum, s) =>
      sum + s.activities.reduce((a, act) => a + act.percentage, 0),
    0,
  );

const TeamHub = () => {
  const { currentUser } = useAuth();
  const {
    getRecordsForManager,
    approve,
    returnForRevision,
    flagActivity,
    unflagActivity,
    managerEdit,
  } = useAllocations();
  const { addNotification } = useNotifications();
  // Hoisted above the filter useMemos so yearOptions can derive years
  // from both allocation records and journal entries.
  const { entries: journalEntries } = useJournal();
  const { employees, getReports } = useEmployees();
  const { categories } = useClientsConfig();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);
  const [summaryFeedback, setSummaryFeedback] = useState("");

  // Local edit buffer — when the manager is editing, streams are held
  // here and flushed to the context on Save / Approve / Return.
  const [editedStreams, setEditedStreams] = useState<WorkStreamData[] | null>(
    null,
  );
  const isEditing = editedStreams !== null;

  const records = useMemo(() => {
    if (!currentUser) return [];
    return getRecordsForManager(currentUser.id, currentUser.team);
  }, [currentUser, getRecordsForManager]);

  // Team-scoped journal entries — used both by the Team Activity
  // Calendar below and by the data-driven yearOptions derivation.
  const teamMemberIds = useMemo(() => {
    if (!currentUser) return new Set<string>();
    return new Set(getReports(currentUser.id).map((e) => e.id));
  }, [currentUser, getReports]);

  const teamJournalEntries = useMemo(
    () => journalEntries.filter((e) => teamMemberIds.has(e.employeeId)),
    [journalEntries, teamMemberIds],
  );

  // --- Global time filter ---------------------------------------------
  //
  // Year + Month dropdowns drive ALL downstream views: KPIs, the
  // submissions table, and the analytics block (chart + insights).
  // Single source of truth — any future filterable surface should read
  // from `filteredRecords`, not `records`.
  //
  // Year options are derived from data so empty years don't pollute the
  // dropdown. Months are static (a manager may want to look ahead at an
  // empty month and see the empty-state messaging rather than have the
  // option silently missing).
  // Default to the current calendar month so managers open on the period
  // they're actually working in (matches what employees are submitting now).
  const [filterYear, setFilterYear] = useState<string>(() =>
    String(new Date().getFullYear()),
  );
  const [filterMonth, setFilterMonth] = useState<string>(
    () => MONTHS[new Date().getMonth()], // 0-based; 0 = January
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(undefined);

  // Data-driven year options.
  //
  // The dropdown's years come exclusively from records that actually
  // exist in the system — allocation records (r.year is already a
  // string like "2026") and team journal entries (date is
  // "YYYY-MM-DD"; slice the leading 4 chars). A Set deduplicates so
  // the current year is never listed twice when records for it
  // already exist.
  //
  // Empty-state fallback: when neither source has any years yet, seed
  // ONLY the current year — no synthetic neighbours. A brand-new
  // manager whose reports haven't submitted gets a single
  // "{currentYear}" option, matching the spec.
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const r of records) {
      if (r.year) years.add(r.year);
    }
    for (const e of teamJournalEntries) {
      const y = e.date?.slice(0, 4);
      if (y && /^\d{4}$/.test(y)) years.add(y);
    }
    if (years.size === 0) {
      years.add(String(new Date().getFullYear()));
    }
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [records, teamJournalEntries]);

  // If the selected year is not in data, fall back to the most recent available year.
  useEffect(() => {
    if (yearOptions.length > 0 && !yearOptions.includes(filterYear)) {
      setFilterYear(yearOptions[0]);
    }
  }, [filterYear, yearOptions]);

  const filteredRecords = useMemo(() => {
    if (dateRange?.from) {
      return records.filter((r) => {
        const y = Number(r.year);
        const mIdx = MONTH_INDEX[r.month] ?? 0;
        const periodStart = new Date(y, mIdx, 1);
        const periodEnd = new Date(y, mIdx + 1, 0);
        if (dateRange.from && periodEnd < dateRange.from) return false;
        if (dateRange.to && periodStart > dateRange.to) return false;
        return true;
      });
    }
    // r.year is stored as a string in AllocationRecord — compare strings directly.
    return records.filter((r) => {
      if (r.year !== filterYear) return false;
      if (filterMonth !== ALL_MONTHS && r.month !== filterMonth) return false;
      return true;
    });
  }, [records, filterYear, filterMonth, dateRange]);

  const isFiltering = filterMonth !== ALL_MONTHS || !!dateRange?.from;

  // --- Submissions data-grid state ------------------------------------
  //
  // Search is a single text box that matches against employee name,
  // month, year, and status — covers every column the user can see at
  // a glance.
  //
  // Sort defaults to most-recent-submission first (`submitted` desc),
  // which is what a manager triaging the queue almost always wants.
  //
  // Pagination is a hard 10/page. Page resets to 1 whenever the
  // result-set definition changes (search or sort), AND we clamp the
  // displayed page when the underlying records shrink (e.g. after
  // approving or returning the last record on the current page).
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("submitted");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  const sortedRecords = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? filteredRecords.filter(
          (r) =>
            r.employeeName.toLowerCase().includes(q) ||
            r.month.toLowerCase().includes(q) ||
            String(r.year).includes(q) ||
            r.status.toLowerCase().includes(q),
        )
      : filteredRecords;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "employee":
          cmp = a.employeeName.localeCompare(b.employeeName);
          break;
        case "period":
          cmp = periodKey(a) - periodKey(b);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "submitted": {
          // Nulls always last regardless of direction — early return
          // bypasses the asc/desc flip below.
          const av = a.submittedAt ? new Date(a.submittedAt).getTime() : null;
          const bv = b.submittedAt ? new Date(b.submittedAt).getTime() : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          cmp = av - bv;
          break;
        }
        case "streams":
          cmp = a.streams.length - b.streams.length;
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [filteredRecords, searchTerm, sortKey, sortDirection]);

  // Reset to page 1 when the result definition changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortKey, sortDirection, filterYear, filterMonth, dateRange]);

  const totalPages = Math.max(
    1,
    Math.ceil(sortedRecords.length / SUBMISSIONS_PAGE_SIZE),
  );
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pagedRecords = useMemo(
    () =>
      sortedRecords.slice(
        (safePage - 1) * SUBMISSIONS_PAGE_SIZE,
        safePage * SUBMISSIONS_PAGE_SIZE,
      ),
    [sortedRecords, safePage],
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Submitted defaults to desc (newest first), everything else asc.
      setSortDirection(key === "submitted" ? "desc" : "asc");
    }
  };

  // --- Defense-in-depth isolation audit -------------------------------
  // Dev-only last-line audit. Keys off managerId only — a manager may
  // legitimately have reports across multiple teams, so a team mismatch
  // is not a leak.
  if (process.env.NODE_ENV !== "production" && currentUser) {
    for (const r of records) {
      if (r.managerId !== currentUser.id) {
        // eslint-disable-next-line no-console
        console.error(
          "[TeamHub] Data isolation violation: record",
          r.id,
          `(managerId="${r.managerId}")`,
          "reached manager",
          `"${currentUser.id}"`,
        );
      }
    }
  }

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId),
    [records, selectedId],
  );

  // Reset local edit state whenever the selected record changes
  // (opening, closing, or jumping between records).
  useEffect(() => {
    setEditedStreams(null);
  }, [selectedId]);

  // The streams the modal displays — edited buffer if present,
  // otherwise the record's own streams.
  const displayStreams = editedStreams ?? selected?.streams ?? [];
  const displayTotal = sumStreamTotals(displayStreams);

  const flagEntries = useMemo(
    () => (selected?.flags ? Object.entries(selected.flags) : []),
    [selected],
  );
  const flagCount = flagEntries.length;

  const draftCount = filteredRecords.filter((r) => r.status === "Draft").length;
  const pendingCount = filteredRecords.filter((r) => r.status === "Pending Review").length;
  const approvedCount = filteredRecords.filter((r) => r.status === "Approved").length;
  const revisionCount = filteredRecords.filter((r) => r.status === "Needs Revision").length;

  const canReview = selected?.status === "Pending Review";

  // ── Team Activity Calendar ────────────────────────────────────────────
  // Hooks for journal/employees/clients live at the top of the
  // component now (so yearOptions can use them). teamMemberIds and
  // teamJournalEntries are also defined up there for the same reason.
  //
  // Height parity between the left "Work Allocation Breakdown" card and
  // the right "Team Activity Calendar" card is enforced purely by CSS
  // Grid (`items-stretch` on the grid + `h-full` on each child). No
  // JavaScript ResizeObserver needed — the taller column dictates the
  // row height, and the activity feed scrolls within its fixed box.
  const [selectedCalDate, setSelectedCalDate] = useState<Date>(new Date());

  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const teamDatesWithActivity = useMemo(
    () => new Set(teamJournalEntries.map((e) => e.date)),
    [teamJournalEntries],
  );

  const feedEntries = useMemo(() => {
    const dateKey = format(selectedCalDate, "yyyy-MM-dd");
    const seen = new Set<string>();
    const result: JournalEntry[] = [];
    for (const entry of teamJournalEntries) {
      if (entry.date === dateKey && !seen.has(entry.employeeId)) {
        seen.add(entry.employeeId);
        result.push(entry);
      }
    }
    return result;
  }, [teamJournalEntries, selectedCalDate]);

  const handleStartEdit = () => {
    if (!selected) return;
    // Deep clone the streams so edits don't mutate the context's
    // state object before we commit.
    setEditedStreams(
      selected.streams.map((s) => ({
        ...s,
        activities: s.activities.map((a) => ({ ...a })),
      })),
    );
  };

  const handleCancelEdit = () => {
    setEditedStreams(null);
    toast.info("Edits discarded.");
  };

  const handleSaveEdit = () => {
    if (!selected || !editedStreams || !currentUser) return;
    if (Math.abs(displayTotal - 100) > 0.01) {
      toast.error(
        `Total allocation must equal 100% (currently ${displayTotal.toFixed(2)}%).`,
      );
      return;
    }
    managerEdit(selected.id, editedStreams, {
      userId: currentUser.id,
      userName: `${currentUser.firstName} ${currentUser.lastName}`,
    });
    setEditedStreams(null);
    toast.success("Edits saved", {
      description: `${selected.employeeName}'s allocation updated. Flags cleared.`,
    });
  };

  const handleApprove = () => {
    if (!selected || !currentUser) return;

    // If manager has unsaved edits, save them first as part of the
    // approve. One commit, transparent audit.
    if (isEditing && editedStreams) {
      if (Math.abs(displayTotal - 100) > 0.01) {
        toast.error(
          `Total must equal 100% before approving (currently ${displayTotal.toFixed(2)}%).`,
        );
        return;
      }
      managerEdit(selected.id, editedStreams, {
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
      });
    } else if (flagCount > 0) {
      // Not editing and flags remain — block approval.
      toast.error("Clear all flags before approving.", {
        description: `${flagCount} ${flagCount === 1 ? "card is" : "cards are"} still flagged.`,
      });
      return;
    }

    approve(selected.id);
    toast.success("Allocation approved", {
      description: `${selected.employeeName} — ${selected.month} ${selected.year}`,
    });
    addNotification({
      targetUserId: selected.employeeId,
      title: "Allocation Approved",
      message: `Your work allocation for ${selected.month} ${selected.year} has been approved.`,
      type: "success",
      actionUrl: "/allocations",
    });
    setSelectedId(null);
  };

  const openReturnConfirm = () => {
    // If editing, save edits first — the employee sees the edited
    // version when revising. Skip the flag-required check in that
    // case because manager's edits serve as the feedback.
    if (isEditing && editedStreams) {
      if (!selected || !currentUser) return;
      if (Math.abs(displayTotal - 100) > 0.01) {
        toast.error(
          `Total must equal 100% before returning (currently ${displayTotal.toFixed(2)}%).`,
        );
        return;
      }
      managerEdit(selected.id, editedStreams, {
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
      });
      setEditedStreams(null);
    } else if (flagCount === 0) {
      toast.error("Flag at least one card before returning for revision.");
      return;
    }
    setReturnConfirmOpen(true);
  };

  const handleReturn = () => {
    if (!selected) return;
    const reason = summaryFeedback.trim();
    returnForRevision(selected.id, reason || undefined);
    toast.success("Returned for revision", {
      description: `${selected.employeeName} will see your changes and can revise.`,
    });
    addNotification({
      targetUserId: selected.employeeId,
      title: "Revision Requested",
      message:
        `Your work allocation for ${selected.month} ${selected.year} requires changes.` +
        (reason ? ` Reason: ${reason}` : ""),
      type: "warning",
      actionUrl: "/allocations",
    });
    setReturnConfirmOpen(false);
    setSelectedId(null);
    setSummaryFeedback("");
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">Team Hub</h1>
          {currentUser?.team && (
            <Badge variant="secondary" className="ml-2">
              Scope: {currentUser.team}
            </Badge>
          )}
        </div>

        {/* Global time filter — drives KPIs, table, and analytics.
            Date range picker overrides Year/Month dropdowns when active. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Popover
            open={datePickerOpen}
            onOpenChange={(o) => {
              setDatePickerOpen(o);
              if (o) setPendingRange(dateRange);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 w-9 p-0",
                  dateRange?.from && "border-primary text-primary bg-primary/5",
                )}
                aria-label="Pick custom date range"
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                defaultMonth={pendingRange?.from ?? new Date()}
                selected={pendingRange}
                onSelect={setPendingRange}
                numberOfMonths={2}
                initialFocus
                classNames={{
                  day_selected:
                    "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                  day_range_start:
                    "day-range-start bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  day_range_end:
                    "day-range-end bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  day_range_middle:
                    "aria-selected:bg-primary/10 aria-selected:text-primary",
                  day_today: "text-warning font-black text-[15px]",
                  cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-primary/5 [&:has([aria-selected])]:bg-primary/10 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                  day_outside:
                    "day-outside text-muted-foreground opacity-50 aria-selected:bg-primary/5 aria-selected:text-primary aria-selected:opacity-30",
                }}
              />
              <div className="border-t p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">Start date</span>{" "}
                    {pendingRange?.from ? format(pendingRange.from, "yyyy/MM/dd") : "—"}
                  </span>
                  <span>
                    <span className="font-medium text-foreground">End date</span>{" "}
                    {pendingRange?.to ? format(pendingRange.to, "yyyy/MM/dd") : "—"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPendingRange(undefined)}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDatePickerOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setDateRange(pendingRange?.from ? pendingRange : undefined);
                      setDatePickerOpen(false);
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Select
            value={filterYear}
            onValueChange={(v) => {
              setFilterYear(v);
              setDateRange(undefined);
            }}
            disabled={!!dateRange?.from}
          >
            <SelectTrigger
              className={cn("h-9 w-[120px]", dateRange?.from && "opacity-50")}
            >
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filterMonth}
            onValueChange={(v) => {
              setFilterMonth(v);
              setDateRange(undefined);
            }}
            disabled={!!dateRange?.from}
          >
            <SelectTrigger
              className={cn("h-9 w-[140px]", dateRange?.from && "opacity-50")}
            >
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_MONTHS}>All Months</SelectItem>
              {MONTHS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(isFiltering || dateRange?.from) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const now = new Date();
                setFilterYear(String(now.getFullYear()));
                setFilterMonth(MONTHS[now.getMonth()]);
                setDateRange(undefined);
              }}
              className="h-9 text-xs gap-1 text-muted-foreground"
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {(isFiltering || dateRange?.from) && (
        <p className="text-xs text-muted-foreground -mt-3">
          {/* Period-scoped count only. Pairing the filtered count with the
              all-time total ("0 of 1 … for May 2026") read as contradictory,
              so the counter now strictly reflects the selected period. */}
          {filteredRecords.length} submission
          {filteredRecords.length === 1 ? "" : "s"}
          {dateRange?.from
            ? ` from ${format(dateRange.from, "MMM d, yyyy")}${dateRange.to ? ` to ${format(dateRange.to, "MMM d, yyyy")}` : " onwards"}`
            : `${filterMonth !== ALL_MONTHS ? ` for ${filterMonth}` : ""} ${filterYear}`}
          .
        </p>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Draft</p>
              <p className="text-3xl font-bold text-muted-foreground">{draftCount}</p>
            </div>
            <FileEdit className="h-8 w-8 text-muted-foreground/30" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Pending Review</p>
              <p className="text-3xl font-bold text-warning">{pendingCount}</p>
            </div>
            <Clock className="h-8 w-8 text-warning/40" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Approved</p>
              <p className="text-3xl font-bold text-success">{approvedCount}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-success/40" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Needs Revision</p>
              <p className="text-3xl font-bold text-destructive">{revisionCount}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-destructive/40" />
          </CardContent>
        </Card>
      </div>

      {/* Chart + Team Activity Calendar — side by side.

          `items-stretch` (CSS Grid default, made explicit here for
          intent) plus `h-full` on every wrapper lets the row's
          tallest child set the height, and the shorter side fills to
          match. The activity feed scrolls inside its fixed box.
          The outer mt-2 mirrors TeamAnalytics's internal mt-2 so
          both grid cells start at the same y-offset. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

        {/* Left: Work Allocation Breakdown chart. */}
        <div className="h-full">
          <TeamAnalytics records={filteredRecords} />
        </div>

        {/* Right: Team Activity Calendar — fills the row height
            entirely via h-full; inner CardContent uses flex-1+min-h-0
            so the feed scrolls without growing the panel. */}
        <div className="mt-2 h-full">
        <Card className="flex flex-col overflow-hidden h-full">
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Team Activity Calendar
            </CardTitle>
            {feedEntries.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {format(selectedCalDate, "MMM d")}
                {" · "}
                {feedEntries.length}{" "}
                {feedEntries.length === 1 ? "member" : "members"}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-col md:flex-row gap-6 h-full min-h-0">
            {/* Calendar panel — renders at its natural height; no
                overflow constraint so no scrollbar appears around the
                calendar widget itself. The activity feed beside it
                absorbs the remaining vertical space. */}
            <div className="shrink-0 space-y-3 pr-1">
              <Calendar
                mode="single"
                selected={selectedCalDate}
                onSelect={(d) => d && setSelectedCalDate(d)}
                className="rounded-xl border bg-card"
                modifiers={{
                  hasActivity: (date) =>
                    teamDatesWithActivity.has(format(date, "yyyy-MM-dd")),
                }}
                modifiersClassNames={{
                  hasActivity:
                    "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1.5 after:h-1.5 after:rounded-full after:bg-primary",
                }}
              />
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1 pb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                <span>Days with team activity</span>
              </div>
            </div>

            {/* Activity feed panel — flex-1 + min-h-0 lets the scroll
                area absorb whatever vertical space remains inside the
                fixed-height card. Expanding accordion items scrolls in
                place instead of pushing the panel taller. */}
            <div className="flex-1 min-w-0 min-h-0 space-y-3 overflow-y-auto pr-2">
              <div>
                <p className="font-semibold text-sm">
                  {format(selectedCalDate, "EEEE, MMMM d, yyyy")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {feedEntries.length === 0
                    ? "No activity logged on this day"
                    : `${feedEntries.length} ${feedEntries.length === 1 ? "team member" : "team members"} logged activity`}
                </p>
              </div>

              {feedEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 border rounded-xl bg-muted/20 text-center">
                  <CalendarDays className="h-8 w-8 text-muted-foreground/25 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No activity on this day
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Select a highlighted date to see team logs
                  </p>
                </div>
              ) : (
                <Accordion type="multiple" className="space-y-2">
                    {feedEntries.map((entry) => {
                      const emp = employeeMap.get(entry.employeeId);
                      const name = emp
                        ? `${emp.firstName} ${emp.lastName}`
                        : entry.employeeId;
                      const initials = emp
                        ? `${emp.firstName[0]}${emp.lastName[0]}`.toUpperCase()
                        : entry.employeeId.slice(0, 2).toUpperCase();
                      const blockCount = entry.blocks?.length ?? null;
                      const lineCount = entry.content
                        .split("\n")
                        .filter((l) => l.trim()).length;

                      return (
                        <AccordionItem
                          key={entry.employeeId}
                          value={entry.employeeId}
                          className="border rounded-xl overflow-hidden"
                        >
                          <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/30 [&>svg]:ml-2">
                            <div className="flex items-center gap-3 min-w-0 w-full">
                              <Avatar className="h-8 w-8 shrink-0">
                                <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <div className="text-left min-w-0 flex-1">
                                <p className="text-sm font-medium leading-tight">
                                  {name}
                                </p>
                                {emp?.jobTitle && (
                                  <p className="text-[11px] text-muted-foreground">
                                    {emp.jobTitle}
                                  </p>
                                )}
                              </div>
                              <Badge
                                variant="secondary"
                                className="shrink-0 text-[10px] h-5 px-1.5 mr-2 font-normal"
                              >
                                {blockCount !== null
                                  ? `${blockCount} ${blockCount === 1 ? "block" : "blocks"}`
                                  : `${lineCount} ${lineCount === 1 ? "line" : "lines"}`}
                              </Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-4 pb-4 pt-0">
                            <div className="border-t pt-3 space-y-3">
                              {(() => {
                                // Prefer freshly-derived blocks (handles
                                // multi-line entries whose stored blocks
                                // pre-date the continuation-line grouping
                                // fix). Falls back to stored blocks, then
                                // to the raw content list when neither
                                // produces time-bearing rows.
                                const freshBlocks = deriveBlocksFromContent(
                                  entry.content,
                                );
                                const displayBlocks =
                                  freshBlocks.length > 0
                                    ? freshBlocks
                                    : entry.blocks && entry.blocks.length > 0
                                    ? entry.blocks
                                    : null;

                                if (displayBlocks) {
                                  return displayBlocks.map((block) => (
                                    <div
                                      key={block.id}
                                      className="flex gap-3 text-sm"
                                    >
                                      <div className="shrink-0 font-mono text-[11px] text-muted-foreground whitespace-nowrap pt-0.5 w-[130px]">
                                        {fmt12(block.startTime)}
                                        {" – "}
                                        {fmt12(block.endTime)}
                                      </div>
                                      <p className="flex-1 min-w-0 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                        {renderTaggedText(block.description, categories)}
                                      </p>
                                    </div>
                                  ));
                                }

                                return entry.content
                                  .split("\n")
                                  .filter((l) => l.trim())
                                  .map((line, i) => {
                                    const clean = line
                                      .replace(/^[-•]\s*/, "")
                                      .trim();
                                    return (
                                      <div
                                        key={i}
                                        className="flex gap-3 text-sm items-start"
                                      >
                                        <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-border/60 mt-[7px]" />
                                        <p className="flex-1 min-w-0 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                          {renderTaggedText(clean, categories)}
                                        </p>
                                      </div>
                                    );
                                  });
                              })()}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      </div>{/* end mt-2 wrapper symmetric with TeamAnalytics */}

      </div>{/* end chart + calendar grid */}

      {/* Submissions table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              Team Submissions
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({sortedRecords.length}
                {searchTerm.trim() && filteredRecords.length !== sortedRecords.length
                  ? ` of ${filteredRecords.length}`
                  : ""})
              </span>
            </CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, period, status…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No submissions from your team yet.
            </p>
          ) : filteredRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No submissions in the selected time period.
            </p>
          ) : sortedRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No submissions match your search.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <SortableHeader
                        label="Employee"
                        columnKey="employee"
                        currentKey={sortKey}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                    </TableHead>
                    <TableHead>
                      <SortableHeader
                        label="Period"
                        columnKey="period"
                        currentKey={sortKey}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                    </TableHead>
                    <TableHead>
                      <SortableHeader
                        label="Status"
                        columnKey="status"
                        currentKey={sortKey}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                    </TableHead>
                    <TableHead>
                      <SortableHeader
                        label="Submitted"
                        columnKey="submitted"
                        currentKey={sortKey}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                    </TableHead>
                    <TableHead>
                      <SortableHeader
                        label="Streams"
                        columnKey="streams"
                        currentKey={sortKey}
                        direction={sortDirection}
                        onSort={handleSort}
                      />
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRecords.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(r.id)}
                    >
                      <TableCell className="font-medium">{r.employeeName}</TableCell>
                      <TableCell>
                        {r.month} {r.year}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColor[r.status]}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.submittedAt
                          ? new Date(r.submittedAt).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{r.streams.length}</TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={currentPage}
                pageSize={SUBMISSIONS_PAGE_SIZE}
                totalItems={sortedRecords.length}
                onPageChange={setCurrentPage}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail modal */}
      <Dialog
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-3">
                  <div>
                    <p>{selected.employeeName}</p>
                    <p className="text-sm font-normal text-muted-foreground">
                      {selected.month} {selected.year} · {selected.team}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {flagCount > 0 && !isEditing && (
                      <Badge
                        variant="outline"
                        className="text-warning border-warning/40 bg-warning/10"
                      >
                        <Flag className="h-3 w-3 mr-1" />
                        {flagCount} flagged
                      </Badge>
                    )}
                    {isEditing && (
                      <Badge className="bg-primary/10 text-primary border-primary/30">
                        <Pencil className="h-3 w-3 mr-1" />
                        Editing
                      </Badge>
                    )}
                    <Badge className={statusColor[selected.status]}>
                      {selected.status}
                    </Badge>
                  </div>
                </DialogTitle>
              </DialogHeader>

              {/* Audit stamp — who last edited and when. Shown to
                  make manager-side changes visible to the team. */}
              {selected.lastEditedBy && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
                  <History className="h-3 w-3 shrink-0" />
                  <span>
                    Last edited by{" "}
                    <span className="font-medium text-foreground">
                      {selected.lastEditedBy.userName}
                    </span>{" "}
                    on{" "}
                    {new Date(selected.lastEditedBy.at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              )}

              <div className="space-y-4 py-2">
                {isEditing && editedStreams ? (
                  <ReviewEditor
                    streams={editedStreams}
                    onStreamsChange={setEditedStreams}
                  />
                ) : (
                  displayStreams.map((stream, si) => {
                    const subtotal = stream.activities.reduce(
                      (a, b) => a + b.percentage,
                      0,
                    );
                    return (
                      <div key={si} className="border rounded-lg overflow-hidden">
                        <div className="px-4 py-2 bg-muted/40 flex items-center justify-between border-l-4 border-l-primary">
                          <span className="font-semibold text-sm">
                            {stream.category}
                          </span>
                          <span className="text-sm text-primary font-semibold">
                            {subtotal.toFixed(2)}%
                          </span>
                        </div>
                        <div className="divide-y">
                          {stream.activities.map((a) => {
                            const flag = selected.flags?.[a.id];
                            return (
                              <div
                                key={a.id}
                                className={`p-3 text-sm ${flag ? "bg-warning/10" : ""}`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-medium">
                                        {a.workType}{" "}
                                        <span className="text-muted-foreground font-normal">
                                          · {a.client}
                                        </span>
                                      </span>
                                      {a.subCategory && (
                                        <span
                                          className="inline-flex items-center h-5 px-1.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                                          style={{
                                            background: "hsl(var(--primary-pastel))",
                                            color: "hsl(var(--primary))",
                                            letterSpacing: "0.03em",
                                          }}
                                          title={`Sub category: ${a.subCategory}`}
                                        >
                                          {a.subCategory}
                                        </span>
                                      )}
                                    </div>
                                    {a.description && (
                                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">
                                        {a.description}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-primary font-semibold">
                                      {a.percentage}%
                                    </span>
                                    {canReview && (
                                      <FlagControl
                                        isFlagged={!!flag}
                                        existingReason={flag?.reason}
                                        onFlag={(reason) =>
                                          flagActivity(selected.id, a.id, reason)
                                        }
                                        onClear={() =>
                                          unflagActivity(selected.id, a.id)
                                        }
                                      />
                                    )}
                                  </div>
                                </div>
                                {flag && (
                                  <div className="mt-2 rounded-md bg-destructive/8 border border-destructive/20 p-2 text-xs text-foreground">
                                    <span className="font-medium">Flagged:</span>{" "}
                                    {flag.reason}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}

                {isEditing && (
                  <div className="flex items-center justify-end gap-2 text-sm border-t pt-3">
                    <span className="text-muted-foreground">Grand Total:</span>
                    <span
                      className={`font-bold text-lg tabular-nums ${
                        Math.abs(displayTotal - 100) < 0.01
                          ? "text-success"
                          : "text-destructive"
                      }`}
                    >
                      {displayTotal.toFixed(2)}%
                    </span>
                  </div>
                )}

                {selected.feedback && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-xs font-medium text-destructive">
                      Previous summary feedback:
                    </p>
                    <p className="text-sm text-foreground mt-1">
                      {selected.feedback}
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2">
                {canReview ? (
                  isEditing ? (
                    <>
                      <Button variant="outline" onClick={handleCancelEdit}>
                        Cancel Edits
                      </Button>
                      <Button variant="secondary" onClick={handleSaveEdit}>
                        Save Edits
                      </Button>
                      <Button
                        variant="outline"
                        onClick={openReturnConfirm}
                      >
                        Save &amp; Return for Revision
                      </Button>
                      <Button
                        onClick={handleApprove}
                      >
                        Save &amp; Approve
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={handleStartEdit}
                        className="gap-1"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        onClick={openReturnConfirm}
                        disabled={flagCount === 0}
                      >
                        Return for Revision
                        {flagCount > 0 ? ` (${flagCount})` : ""}
                      </Button>
                      <Button
                        onClick={handleApprove}
                        disabled={flagCount > 0}
                      >
                        Approve
                      </Button>
                    </>
                  )
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setSelectedId(null)}
                  >
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm return-for-revision (summary comment optional) */}
      <Dialog open={returnConfirmOpen} onOpenChange={setReturnConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Return for Revision</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {selected?.employeeName} will see the current state of their
            allocation{" "}
            {flagCount > 0 && !isEditing
              ? `with ${flagCount} flagged ${flagCount === 1 ? "card" : "cards"} and `
              : ""}
            the optional summary comment below.
          </p>
          <Textarea
            value={summaryFeedback}
            onChange={(e) => setSummaryFeedback(e.target.value)}
            placeholder="Optional summary — overall pattern, what to prioritize, etc."
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReturnConfirmOpen(false);
                setSummaryFeedback("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleReturn}>Send to Employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Team Activity Calendar helpers — module-level, no hooks.
// ---------------------------------------------------------------------------

const fmt12 = (hhmm: string): string => {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
};

const ACTIVITY_CLIENT_RE = /@([A-Za-z][A-Za-z0-9_-]*)/g;
const ACTIVITY_CAT_RE = /#([A-Za-z][A-Za-z0-9_/-]*)/g;

function extractActivityTags(text: string) {
  const clients = [...text.matchAll(ACTIVITY_CLIENT_RE)].map((m) =>
    m[1].toUpperCase(),
  );
  const categories = [...text.matchAll(ACTIVITY_CAT_RE)].map((m) =>
    m[1].replace(/-/g, " "),
  );
  return {
    clients: [...new Set(clients)],
    categories: [...new Set(categories)],
  };
}

function renderTaggedText(text: string, knownCategories: readonly string[]) {
  // Normalize multi-word category tags before tokenizing.
  // "#Quick Policy Support" → "#Quick-Policy-Support" so the
  // single-word regex can capture the full tag.
  let normalized = text;
  const sorted = [...knownCategories]
    .filter((c) => c.includes(" "))
    .sort((a, b) => b.length - a.length); // longest first to avoid partial matches
  for (const cat of sorted) {
    const escaped = cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?<![A-Za-z0-9])#${escaped}(?![A-Za-z0-9_/-])`,
      "gi",
    );
    normalized = normalized.replace(re, "#" + cat.replace(/\s+/g, "-"));
  }

  const TOKEN_RE = /(@[A-Za-z][A-Za-z0-9_-]*)|(#[A-Za-z][A-Za-z0-9_/-]*)/g;
  const nodes: (string | JSX.Element)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(normalized)) !== null) {
    if (m.index > last) nodes.push(normalized.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("@")) {
      nodes.push(
        <span
          key={m.index}
          className="font-medium text-primary/80 bg-primary/8 rounded px-0.5"
        >
          {tok}
        </span>,
      );
    } else {
      nodes.push(
        <span
          key={m.index}
          className="font-medium text-violet-700 bg-violet-50 rounded px-0.5 dark:text-violet-300 dark:bg-violet-950/50"
        >
          {tok.replace(/-/g, " ")}
        </span>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < normalized.length) nodes.push(normalized.slice(last));
  return nodes;
}

// ---------------------------------------------------------------------------
// SortableHeader — clickable table header cell with sort indicator.
//
// Three visual states:
//   - inactive (this column is NOT the active sort): muted up/down arrows
//   - active asc: solid up arrow
//   - active desc: solid down arrow
//
// Click cycles the parent's sort state via onSort(columnKey). Whether
// that means "switch to this column asc" or "flip direction" is the
// parent's call — this component just dispatches the click.
// ---------------------------------------------------------------------------

interface SortableHeaderProps {
  label: string;
  columnKey: SortKey;
  currentKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}

const SortableHeader = ({
  label,
  columnKey,
  currentKey,
  direction,
  onSort,
}: SortableHeaderProps) => {
  const isActive = currentKey === columnKey;
  const Icon = !isActive
    ? ArrowUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 rounded hover:bg-muted/50"
      aria-label={`Sort by ${label}`}
      aria-sort={
        isActive ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <span className="font-medium">{label}</span>
      <Icon
        className={`h-3 w-3 ${
          isActive ? "text-foreground" : "text-muted-foreground/50"
        }`}
      />
    </button>
  );
};

// ---------------------------------------------------------------------------
// ReviewEditor — inline edit UI for manager review.
//
// Separate from Workspace because the review flow has different chrome:
// no prompt box, no auto-generate, no submit button (Save/Approve/Return
// live on the parent Dialog footer). Reuses the same ActivityData shape
// so cards are interchangeable between the two surfaces.
// ---------------------------------------------------------------------------

interface ReviewEditorProps {
  streams: WorkStreamData[];
  onStreamsChange: (s: WorkStreamData[]) => void;
}

const ReviewEditor = ({ streams, onStreamsChange }: ReviewEditorProps) => {
  const {
    categories,
    subCategoriesForMain,
    workTypesForParent,
    sharedClientList,
  } = useClientsConfig();

  const updateActivity = (
    sIdx: number,
    aIdx: number,
    field: keyof ActivityData,
    value: string | number | null,
  ) => {
    onStreamsChange(
      streams.map((s, si) =>
        si === sIdx
          ? {
              ...s,
              activities: s.activities.map((a, ai) =>
                ai === aIdx ? { ...a, [field]: value } : a,
              ),
            }
          : s,
      ),
    );
  };

  const removeActivity = (sIdx: number, aIdx: number) => {
    const updated = streams
      .map((s, i) =>
        i === sIdx
          ? {
              ...s,
              activities: s.activities.filter((_, j) => j !== aIdx),
            }
          : s,
      )
      .filter((s) => s.activities.length > 0);
    onStreamsChange(updated);
  };

  return (
    <div className="space-y-4">
      {streams.map((stream, sIdx) => {
        const subtotal = stream.activities.reduce(
          (sum, a) => sum + a.percentage,
          0,
        );
        return (
          <div key={sIdx} className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted/40 flex items-center justify-between border-l-4 border-l-primary">
              <span className="font-semibold text-sm">{stream.category}</span>
              <span className="text-sm text-primary font-semibold">
                {subtotal.toFixed(2)}%
              </span>
            </div>
            <div className="divide-y">
              {stream.activities.map((activity, aIdx) => {
                // Phase P: derive subs + active parent per activity.
                // Same rules as Workspace: main with no subs attaches
                // work types directly; main with subs gates work type
                // behind the sub picker.
                const subsForMain = subCategoriesForMain(
                  activity.workCategory,
                );
                const hasSubs = subsForMain.length > 0;
                const activeParent = hasSubs
                  ? activity.subCategory
                  : activity.workCategory;
                const wtOptions = activeParent
                  ? workTypesForParent(activeParent).map((w) => w.name)
                  : [];

                return (
                  <div key={activity.id} className="p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Work Category
                        </label>
                        <Select
                          value={activity.workCategory}
                          onValueChange={(v) => {
                            // Cascade reset: main change clears sub
                            // and work type so the card doesn't carry
                            // stale cross-hierarchy values.
                            const next = streams.map((s, si) =>
                              si === sIdx
                                ? {
                                    ...s,
                                    activities: s.activities.map((a, ai) =>
                                      ai === aIdx
                                        ? {
                                            ...a,
                                            workCategory: v,
                                            subCategory: null,
                                            workType: "",
                                          }
                                        : a,
                                    ),
                                  }
                                : s,
                            );
                            onStreamsChange(next);
                          }}
                        >
                          <SelectTrigger className="text-sm h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {hasSubs && (
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Sub Category
                          </label>
                          <Select
                            value={activity.subCategory ?? ""}
                            onValueChange={(v) => {
                              // Sub change clears work type.
                              const next = streams.map((s, si) =>
                                si === sIdx
                                  ? {
                                      ...s,
                                      activities: s.activities.map((a, ai) =>
                                        ai === aIdx
                                          ? {
                                              ...a,
                                              subCategory: v,
                                              workType: "",
                                            }
                                          : a,
                                      ),
                                    }
                                  : s,
                              );
                              onStreamsChange(next);
                            }}
                          >
                            <SelectTrigger className="text-sm h-8">
                              <SelectValue placeholder="Select sub..." />
                            </SelectTrigger>
                            <SelectContent>
                              {subsForMain.map((sub) => (
                                <SelectItem key={sub.name} value={sub.name}>
                                  {sub.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Work Type
                        </label>
                        <Select
                          value={activity.workType}
                          onValueChange={(v) =>
                            updateActivity(sIdx, aIdx, "workType", v)
                          }
                          disabled={hasSubs && !activity.subCategory}
                        >
                          <SelectTrigger className="text-sm h-8">
                            <SelectValue
                              placeholder={
                                hasSubs && !activity.subCategory
                                  ? "Pick sub first..."
                                  : "Select..."
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {wtOptions.length === 0 ? (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                No work types available.
                              </div>
                            ) : (
                              wtOptions.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Client
                        </label>
                        <Select
                          value={activity.client}
                          onValueChange={(v) =>
                            updateActivity(sIdx, aIdx, "client", v)
                          }
                        >
                          <SelectTrigger className="text-sm h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {sharedClientList.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                            {activity.client &&
                              !sharedClientList.includes(activity.client) && (
                                <SelectItem value={activity.client}>
                                  {activity.client} (custom)
                                </SelectItem>
                              )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          % Allocated
                        </label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          value={activity.percentage || ""}
                          onChange={(e) =>
                            updateActivity(
                              sIdx,
                              aIdx,
                              "percentage",
                              parseFloat(e.target.value) || 0,
                            )
                          }
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        Description
                      </label>
                      <Textarea
                        value={activity.description}
                        onChange={(e) =>
                          updateActivity(
                            sIdx,
                            aIdx,
                            "description",
                            e.target.value,
                          )
                        }
                        className="min-h-[50px] text-sm"
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => removeActivity(sIdx, aIdx)}
                        className="text-destructive/60 hover:text-destructive text-xs flex items-center gap-1"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove activity
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------

interface FlagControlProps {
  isFlagged: boolean;
  existingReason?: string;
  onFlag: (reason: string) => void;
  onClear: () => void;
}

/**
 * Inline flag control for a single activity (read-only mode).
 * Unchanged from pre-Phase-K.
 */
const FlagControl = ({
  isFlagged,
  existingReason,
  onFlag,
  onClear,
}: FlagControlProps) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(existingReason ?? "");

  const save = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Add a reason for the flag.");
      return;
    }
    onFlag(trimmed);
    setOpen(false);
  };

  if (isFlagged) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={onClear}
        className="h-7 text-xs gap-1 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30"
        aria-label="Clear flag"
      >
        <X className="h-3 w-3" /> Flagged
      </Button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setReason(existingReason ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
        >
          <Flag className="h-3 w-3" /> Flag
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-2">
          <p className="font-semibold text-sm">Flag this activity</p>
          <p className="text-xs text-muted-foreground">
            The employee will see this reason and can revise this specific
            card before resubmitting.
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Percentage seems high given the described scope."
            className="min-h-[80px] text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Flag
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default TeamHub;
