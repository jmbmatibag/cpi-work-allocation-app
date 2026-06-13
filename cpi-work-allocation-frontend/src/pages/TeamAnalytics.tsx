import { useState, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChevronRight, Home } from "lucide-react";
import type { AllocationRecord } from "@/contexts/AllocationsContext";

// ─── Palette ─────────────────────────────────────────────────────────────────

const PALETTE = [
  "hsl(var(--primary))",
  "hsl(262 80% 60%)",
  "hsl(186 70% 45%)",
  "hsl(142 60% 45%)",
  "hsl(38 90% 55%)",
  "hsl(0 65% 57%)",
  "hsl(310 55% 55%)",
  "hsl(200 75% 50%)",
];
const color = (i: number) => PALETTE[i % PALETTE.length];

// ─── Types ────────────────────────────────────────────────────────────────────

type DrillLevel = "category" | "sub" | "workType" | "person";

interface DrillPath {
  level: DrillLevel;
  label: string;
}

interface SliceData {
  name: string;
  value: number;
  count: number;
}

interface FlatActivity {
  employeeName: string;
  workCategory: string;
  subCategory: string | null;
  workType: string;
  percentage: number;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function flattenRecords(records: AllocationRecord[]): FlatActivity[] {
  const out: FlatActivity[] = [];
  for (const rec of records) {
    for (const stream of rec.streams) {
      for (const act of stream.activities) {
        out.push({
          employeeName: rec.employeeName,
          workCategory: stream.category,
          subCategory: (act as { subCategory?: string | null }).subCategory ?? null,
          workType: act.workType,
          percentage: act.percentage,
        });
      }
    }
  }
  return out;
}

const NEXT_LEVEL: Record<DrillLevel, DrillLevel | null> = {
  category: "sub",
  sub: "workType",
  workType: "person",
  person: null,
};

const LEVEL_LABELS: Record<DrillLevel, string> = {
  category: "Work Category",
  sub: "Sub Category",
  workType: "Work Type",
  person: "Person",
};

function buildSlices(
  activities: FlatActivity[],
  level: DrillLevel,
  path: DrillPath[],
): SliceData[] {
  let filtered = activities;
  for (const step of path) {
    switch (step.level) {
      case "category": filtered = filtered.filter((a) => a.workCategory === step.label); break;
      case "sub":      filtered = filtered.filter((a) => (a.subCategory ?? a.workType) === step.label); break;
      case "workType": filtered = filtered.filter((a) => a.workType === step.label); break;
    }
  }

  const groupKey = (a: FlatActivity): string => {
    switch (level) {
      case "category":  return a.workCategory;
      case "sub":       return a.subCategory ?? a.workType;
      case "workType":  return a.workType;
      case "person":    return a.employeeName;
    }
  };

  const map = new Map<string, { value: number; count: number }>();
  for (const a of filtered) {
    const k = groupKey(a);
    const e = map.get(k) ?? { value: 0, count: 0 };
    map.set(k, { value: e.value + a.percentage, count: e.count + 1 });
  }

  return [...map.entries()]
    .map(([name, { value, count }]) => ({
      name,
      value: parseFloat(value.toFixed(2)),
      count,
    }))
    .sort((a, b) => b.value - a.value);
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

const CustomTooltip = ({
  active,
  payload,
  hasChildren,
}: {
  active?: boolean;
  payload?: Array<{ payload: SliceData }>;
  hasChildren?: boolean;
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg bg-popover border border-border text-popover-foreground">
      <p className="font-semibold mb-0.5">{d.name}</p>
      <p className="text-muted-foreground">
        {d.value.toFixed(2)}% · {d.count} {d.count === 1 ? "activity" : "activities"}
      </p>
      {hasChildren && (
        <p className="mt-1 text-[10px] text-primary">Click to drill down ↓</p>
      )}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const TeamAnalytics = ({ records }: TeamAnalyticsProps) => {
  const activities = useMemo(() => flattenRecords(records), [records]);
  const [level, setLevel] = useState<DrillLevel>("category");
  const [path, setPath] = useState<DrillPath[]>([]);

  const slices = useMemo(() => buildSlices(activities, level, path), [activities, level, path]);
  const nextLevel = NEXT_LEVEL[level];

  const handleSliceClick = (data: SliceData) => {
    if (!nextLevel) return;
    setPath((p) => [...p, { level, label: data.name }]);
    setLevel(nextLevel);
  };

  const handleBreadcrumb = (idx: number) => {
    if (idx < 0) { setLevel("category"); setPath([]); return; }
    setPath((p) => p.slice(0, idx + 1));
    setLevel(NEXT_LEVEL[path[idx].level] as DrillLevel);
  };

  if (records.length === 0) {
    return (
      <div className="mt-2 h-full">
        <div className="rounded-xl p-5 h-full bg-card border border-dashed border-border">
          <div className="mb-3">
            <h3 className="text-[14px] font-semibold text-card-foreground">
              Work Allocation Breakdown
            </h3>
            <p className="text-[11px] mt-0.5 text-muted-foreground">
              Work Category · click a slice to drill down
            </p>
          </div>
          <div
            className="flex flex-col items-center justify-center text-center text-muted-foreground"
            style={{ height: 320 }}
          >
            <p className="text-sm">No data available for this period</p>
            <p className="text-[11px] mt-1 text-muted-foreground/60">
              Approved or in-review allocations will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 h-full">
      <div className="rounded-xl p-5 h-full bg-card border border-border">
        <div className="mb-3">
          <h3 className="text-[14px] font-semibold text-card-foreground">
            Work Allocation Breakdown
          </h3>
          <p className="text-[11px] mt-0.5 text-muted-foreground">
            {LEVEL_LABELS[level]}{nextLevel ? " · click a slice to drill down" : " · deepest level"}
          </p>
        </div>

        {/* Breadcrumb */}
        {path.length > 0 && (
          <div className="flex items-center flex-wrap gap-1 mb-3 text-[11px]">
            <button
              onClick={() => handleBreadcrumb(-1)}
              className="flex items-center gap-0.5 text-primary hover:opacity-70 transition-opacity"
            >
              <Home className="h-3 w-3" /> All
            </button>
            {path.map((step, i) => (
              <span key={i} className="flex items-center gap-0.5">
                <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                <button
                  onClick={() => handleBreadcrumb(i)}
                  className={
                    i === path.length - 1
                      ? "font-semibold text-foreground hover:opacity-70 transition-opacity"
                      : "text-primary hover:opacity-70 transition-opacity"
                  }
                >
                  {step.label}
                </button>
              </span>
            ))}
          </div>
        )}

        {slices.length === 0 ? (
          <div className="flex items-center justify-center h-[260px] text-sm text-muted-foreground">
            No approved or in-review allocations for this period yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={slices}
                cx="50%" cy="50%"
                innerRadius={58} outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                onClick={(d: SliceData) => handleSliceClick(d)}
                style={{ cursor: nextLevel ? "pointer" : "default" }}
                stroke="hsl(var(--card))"
                strokeWidth={1}
              >
                {slices.map((_, i) => <Cell key={i} fill={color(i)} />)}
              </Pie>
              <Tooltip content={<CustomTooltip hasChildren={!!nextLevel} />} />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) => (
                  <span className="text-foreground" style={{ fontSize: 11 }}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}

        {/* Value list */}
        {slices.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
            {slices.map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 text-[12px]">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: color(i) }}
                />
                <span className="flex-1 truncate text-foreground">{s.name}</span>
                <span className="tabular-nums font-medium text-muted-foreground">
                  {s.value.toFixed(1)}%
                </span>
                {nextLevel && (
                  <button
                    onClick={() => handleSliceClick(s)}
                    className="text-[10px] text-primary hover:opacity-70 transition-opacity"
                  >
                    drill ↓
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

// Type re-export to satisfy the import
interface TeamAnalyticsProps {
  records: AllocationRecord[];
}
