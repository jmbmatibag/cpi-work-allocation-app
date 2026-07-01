import { useMemo, useState, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useJournal } from "@/contexts/JournalContext";
import {
  useAllocations,
  AllocationStatus,
  MONTH_NAMES,
  AllocationRecord,
} from "@/contexts/AllocationsContext";
import {
  CalendarDays,
  Clock,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Flag,
  ArrowRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/**
 * Chart palette — lead with the two CPI brand tones, support with
 * reduced-saturation cool/warm pairs. Kept to six so categories remain
 * distinguishable without the chart turning into a rainbow.
 */
const CHART_COLORS = [
  "hsl(var(--cpi-blue))",
  "hsl(var(--accent))",
  "hsl(210 65% 60%)",
  "hsl(35 70% 58%)",
  "hsl(170 50% 45%)",
  "hsl(265 50% 62%)",
];

/** How many months of history the trend chart shows. */
const TREND_WINDOW_MONTHS = 3;

interface RoundedTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

const RoundedTooltip = ({ active, payload, label }: RoundedTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-xl border border-border/60 bg-card/95 backdrop-blur-md shadow-lg shadow-primary/5 px-3.5 py-2.5 text-xs min-w-[180px]">
      <p className="font-semibold text-foreground pb-1.5 mb-1.5 border-b border-border/40">
        {label}
      </p>
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: p.color }}
            />
            <span className="text-muted-foreground flex-1">{p.name}</span>
            <span className="font-medium text-foreground tabular-nums">
              {p.value}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-border/40">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Total
        </span>
        <span className="font-semibold text-primary tabular-nums">{total}%</span>
      </div>
    </div>
  );
};

const statusBadgeClass = (s: AllocationStatus): string => {
  switch (s) {
    case "Draft":          return "bg-muted text-muted-foreground";
    case "Pending Review": return "bg-warning/10 text-warning";
    case "Needs Revision": return "bg-destructive/10 text-destructive";
    case "Approved":       return "bg-success/10 text-success";
  }
};

/**
 * Reduce one allocation record into {bucket: totalPct} by summing
 * every activity's percentage under a bucket label. Month label is
 * the short form used on the chart's X axis.
 *
 * When drillDown is true, activities with a subCategory key as
 * `Main — Sub` (e.g. "Projects — Geniisys") so stacked-area segments
 * split by sub category. Activities without a sub stay keyed by
 * main so mixed taxonomies render sensibly.
 */
function recordToCategoryRow(
  record: AllocationRecord,
  drillDown: boolean,
): Record<string, number | string> {
  const row: Record<string, number | string> = {
    month: MONTH_NAMES[record.monthIndex].slice(0, 3),
  };
  for (const stream of record.streams) {
    for (const activity of stream.activities) {
      const key =
        drillDown && activity.subCategory
          ? `${activity.workCategory} — ${activity.subCategory}`
          : activity.workCategory;
      row[key] = ((row[key] as number) ?? 0) + activity.percentage;
    }
  }
  return row;
}

// ── Allocation Trend Chart ────────────────────────────────────────────────────
// Isolated as a React.memo component so it only re-renders when chart data
// actually changes — not on every unrelated state update in the parent
// (e.g. journal context refreshes, KPI card changes).

interface TrendChartProps {
  trendData: Array<Record<string, number | string>>;
  allCategories: string[];
  drillDown: boolean;
  onToggle: () => void;
}

const AllocationTrendChart = memo(function AllocationTrendChart({
  trendData,
  allCategories,
  drillDown,
  onToggle,
}: TrendChartProps) {
  return (
    <Card className="col-span-2">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          Allocation Trend — Last {TREND_WINDOW_MONTHS} Months
        </CardTitle>
        <button
          type="button"
          role="switch"
          aria-checked={drillDown}
          onClick={onToggle}
          className="flex items-center gap-2 text-xs"
          style={{ color: "hsl(220 10% 45%)" }}
        >
          <span>Split by sub category</span>
          <span
            className="relative inline-flex h-4 w-7 rounded-full transition-colors"
            style={{
              background: drillDown ? "hsl(var(--primary))" : "hsl(220 13% 85%)",
            }}
          >
            <span
              className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
              style={{
                transform: drillDown ? "translateX(14px)" : "translateX(2px)",
                marginTop: "2px",
                boxShadow: "0 1px 2px 0 hsl(220 13% 70% / 0.5)",
              }}
            />
          </span>
        </button>
      </CardHeader>
      <CardContent>
        {trendData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm font-medium">No approved history yet</p>
            <p className="text-xs mt-1 text-center max-w-xs">
              Once your manager approves a submission, your allocation trend
              will appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Compact inline legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4">
              {allCategories.map((cat, i) => (
                <div key={cat} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                    style={{
                      background: CHART_COLORS[i % CHART_COLORS.length],
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{cat}</span>
                </div>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={trendData}
                margin={{ top: 8, right: 16, left: -12, bottom: 0 }}
              >
                <defs>
                  {allCategories.map((cat, i) => (
                    <linearGradient
                      key={cat}
                      id={`grad-${i}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                        stopOpacity={0.32}
                      />
                      <stop
                        offset="100%"
                        stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid
                  strokeDasharray="2 6"
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.5}
                  vertical={false}
                />

                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  dy={6}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                  width={40}
                />
                <Tooltip
                  content={<RoundedTooltip />}
                  cursor={{
                    stroke: "hsl(var(--primary))",
                    strokeOpacity: 0.2,
                    strokeWidth: 1,
                    strokeDasharray: "3 4",
                  }}
                />

                {allCategories.map((cat, i) => (
                  <Area
                    key={cat}
                    type="monotone"
                    dataKey={cat}
                    stackId="1"
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={1.75}
                    fill={`url(#grad-${i})`}
                    isAnimationActive={true}
                    animationDuration={600}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
});

const EmployeeDashboard = () => {
  const { currentUser } = useAuth();
  const { getEntriesForMonth } = useJournal();
  const { getHistoryForEmployee, getRecord } = useAllocations();
  const navigate = useNavigate();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth();
  const currentMonthName = MONTH_NAMES[currentMonthIdx];

  const currentMonthEntries = currentUser
    ? getEntriesForMonth(currentUser.id, currentYear, currentMonthIdx)
    : [];
  const daysLogged = currentMonthEntries.length;

  const history = useMemo(
    () => (currentUser ? getHistoryForEmployee(currentUser.id) : []),
    [currentUser, getHistoryForEmployee],
  );

  // --- Status cards --------------------------------------------------

  // Needs Revision records — what the Phase K callout surfaces. Sorted
  // chronologically oldest-first so if an employee has multiple they
  // see the oldest (most overdue) first.
  const needsRevision = useMemo(
    () => history.filter((r) => r.status === "Needs Revision"),
    [history],
  );

  // Current month — shows status if a record exists for this month,
  // null if the employee hasn't started anything yet.
  const currentRecord = useMemo(
    () =>
      currentUser
        ? getRecord(currentUser.id, currentMonthName, String(currentYear))
        : undefined,
    [currentUser, currentMonthName, currentYear, getRecord],
  );

  // Last Approved submission — walk history newest-first, find the
  // first Approved record. Could be the current month or months back.
  const lastApproved = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].status === "Approved") return history[i];
    }
    return undefined;
  }, [history]);

  // --- Trend chart ---------------------------------------------------

  // Phase P: drill-down toggle splits Projects into Projects — Geniisys
  // and Projects — Quick Policy (and any other sub cat configured). Off by
  // default — the main-category view is the most readable at a glance.
  const [drillDown, setDrillDown] = useState(false);
  // Stable reference — AllocationTrendChart is React.memo'd so a new function
  // identity on every render would defeat the memoization.
  const handleDrillDownToggle = useCallback(() => setDrillDown((v) => !v), []);

  // Last TREND_WINDOW_MONTHS approved records, reshaped into
  // category-keyed rows. Only approved records feed the chart —
  // drafts and pending submissions shouldn't project into the
  // historical visualization.
  const trendData = useMemo(() => {
    const approvedOnly = history.filter((r) => r.status === "Approved");
    const window = approvedOnly.slice(-TREND_WINDOW_MONTHS);
    return window.map((r) => recordToCategoryRow(r, drillDown));
  }, [history, drillDown]);

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const row of trendData) {
      for (const key of Object.keys(row)) {
        if (key !== "month") cats.add(key);
      }
    }
    return Array.from(cats);
  }, [trendData]);

  // --- AI Insight — derived from real trend data ---------------------

  const insight = useMemo(() => {
    if (trendData.length === 0) return null;
    const last = trendData[trendData.length - 1];
    const prev = trendData.length > 1 ? trendData[trendData.length - 2] : null;

    let topCat = "";
    let topVal = 0;
    for (const [k, v] of Object.entries(last)) {
      if (k !== "month" && typeof v === "number" && v > topVal) {
        topVal = v;
        topCat = k;
      }
    }
    if (!topCat) return null;

    const prevVal =
      prev && typeof prev[topCat] === "number"
        ? (prev[topCat] as number)
        : 0;
    const delta = parseFloat((topVal - prevVal).toFixed(2));
    return { topCat, topVal: parseFloat(topVal.toFixed(2)), delta };
  }, [trendData]);

  const currentMonthLabel = now.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-[calc(100vh-3rem)]">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Welcome back, {currentUser?.firstName}
        </h1>
        <p className="text-sm text-muted-foreground">Here's your workspace overview</p>
      </div>

      {/* Needs Revision callout — appears only when the employee
          has records returned for revision. Each row deep-links to
          MonthlyAllocations with ?month=&year= so clicking lands
          them on the exact period. */}
      {needsRevision.length > 0 && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <CardTitle className="text-base text-destructive">
                  {needsRevision.length === 1
                    ? "1 allocation needs your revision"
                    : `${needsRevision.length} allocations need your revision`}
                </CardTitle>
                <p className="text-xs text-destructive/80 mt-0.5">
                  Your manager returned {needsRevision.length === 1 ? "this" : "these"} for edits. Open to see flagged cards and resubmit.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsRevision.map((record) => {
              const flagCount = record.flags ? Object.keys(record.flags).length : 0;
              return (
                <div
                  key={record.id}
                  className="flex items-start justify-between gap-3 rounded-lg bg-card border border-destructive/20 p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">
                        {record.month} {record.year}
                      </span>
                      {flagCount > 0 && (
                        <Badge
                          variant="outline"
                          className="h-5 text-[10px] gap-1 border-destructive/30 bg-destructive/10 text-destructive"
                        >
                          <Flag className="h-2.5 w-2.5" />
                          {flagCount} flagged
                        </Badge>
                      )}
                      {record.lastEditedBy && (
                        <span className="text-[11px] text-muted-foreground">
                          Edited by {record.lastEditedBy.userName}
                        </span>
                      )}
                    </div>
                    {record.feedback && (
                      <p className="text-xs text-foreground/80 mt-1.5 line-clamp-2">
                        <span className="font-medium">Manager's note:</span>{" "}
                        {record.feedback}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 border-destructive/30 text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() =>
                      navigate(
                        `/allocations?month=${encodeURIComponent(record.month)}&year=${encodeURIComponent(record.year)}`,
                      )
                    }
                  >
                    Open
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Days Logged This Month
              </CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary tabular-nums">{daysLogged}</p>
            <p className="text-xs text-muted-foreground mt-1">of ~22 working days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Current Period Status
              </CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {currentRecord ? (
              <>
                <Badge
                  className={`${statusBadgeClass(currentRecord.status)} text-lg px-3 py-1`}
                >
                  {currentRecord.status}
                </Badge>
                <p className="text-xs text-muted-foreground mt-2">
                  {currentMonthLabel}
                </p>
              </>
            ) : (
              <>
                <Badge variant="outline" className="text-lg px-3 py-1 text-muted-foreground">
                  Not Started
                </Badge>
                <p className="text-xs text-muted-foreground mt-2">
                  {currentMonthLabel} — no submission yet
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Last Submission
              </CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {lastApproved ? (
              <>
                <p className="text-3xl font-bold text-success tabular-nums">100%</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {lastApproved.month} {lastApproved.year} — Approved
                </p>
              </>
            ) : (
              <>
                <p className="text-3xl font-bold text-muted-foreground tabular-nums">—</p>
                <p className="text-xs text-muted-foreground mt-1">
                  No approved submissions yet
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts + AI Insights */}
      <div className="grid grid-cols-3 gap-4">
        <AllocationTrendChart
          trendData={trendData}
          allCategories={allCategories}
          drillDown={drillDown}
          onToggle={handleDrillDownToggle}
        />

        {/* Performance Insights */}
        <Card className="bg-gradient-to-br from-primary/5 via-card to-accent/5 border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">
              Performance Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {insight ? (
              <>
                <div className="flex items-start gap-2">
                  {insight.delta >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  )}
                  <p className="text-foreground leading-relaxed">
                    <span className="font-semibold">Analysis:</span> Your focus
                    this period was on{" "}
                    <span className="font-semibold text-primary">{insight.topCat}</span>
                    , accounting for{" "}
                    <span className="font-semibold tabular-nums">
                      {insight.topVal}%
                    </span>{" "}
                    of your logged time.
                    {insight.delta !== 0 && (
                      <>
                        {" "}That's{" "}
                        <span className="font-semibold tabular-nums">
                          {Math.abs(insight.delta)}%{" "}
                          {insight.delta > 0 ? "more" : "less"}
                        </span>{" "}
                        than the previous period.
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 border border-border/40 p-3 text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">
                    Recommendation:
                  </span>{" "}
                  Consider re-balancing time across cross-functional categories
                  to reduce single-stream concentration risk.
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Insights become available once your manager approves at least one
                submission. Keep logging your daily work — approved allocations
                drive this analysis.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default EmployeeDashboard;
