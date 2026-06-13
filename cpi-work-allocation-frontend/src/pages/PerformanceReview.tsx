import { useState } from "react";
import WorkspaceTipModal from "@/components/WorkspaceTipModal";
import { getOnboardingGuide } from "@/lib/onboardingGuides";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Sparkles, Printer, FileText, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAllocations,
  AllocationRecord,
} from "@/contexts/AllocationsContext";
import { useJournal } from "@/contexts/JournalContext";
import { toast } from "sonner";

type Timeframe = "Q1" | "Q2" | "Q3" | "Q4" | "Mid-Year" | "Annual";

const TIMEFRAME_RANGES: Record<
  Timeframe,
  { fromMonth: number; toMonth: number; label: string }
> = {
  Q1:         { fromMonth: 0,  toMonth: 2,  label: "Jan – Mar" },
  Q2:         { fromMonth: 3,  toMonth: 5,  label: "Apr – Jun" },
  Q3:         { fromMonth: 6,  toMonth: 8,  label: "Jul – Sep" },
  Q4:         { fromMonth: 9,  toMonth: 11, label: "Oct – Dec" },
  "Mid-Year": { fromMonth: 0,  toMonth: 5,  label: "Jan – Jun" },
  Annual:     { fromMonth: 0,  toMonth: 11, label: "Jan – Dec" },
};

const STATUS_THRESHOLDS = {
  delivered: 25,
  onTrack: 10,
} as const;

interface MatrixRow {
  kra: string;
  focus: string;
  actualBullets: string[];
  status: "Delivered" | "On-Track" | "At-Risk";
  weight: number;
}

const PerformanceReview = () => {
  const { currentUser } = useAuth();
  const { getApprovedForEmployee } = useAllocations();
  const { getEntriesForMonth } = useJournal();

  const [timeframe, setTimeframe] = useState<Timeframe>("Q2");
  const [year, setYear] = useState("2026");
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string>("");

  const generate = () => {
    if (!currentUser) return;

    const range = TIMEFRAME_RANGES[timeframe];
    const yr = parseInt(year, 10);

    const records: AllocationRecord[] = getApprovedForEmployee(
      currentUser.id,
      range.fromMonth,
      yr,
      range.toMonth,
      yr,
    );

    // Defense-in-depth — context contract says Approved only, but filter
    // again in case of drift. Warn loud in dev.
    const approved = records.filter((r) => r.status === "Approved");
    if (
      process.env.NODE_ENV !== "production" &&
      approved.length !== records.length
    ) {
      // eslint-disable-next-line no-console
      console.error(
        "[PerformanceReview] getApprovedForEmployee returned non-Approved records — contract violation:",
        records
          .filter((r) => r.status !== "Approved")
          .map((r) => ({ id: r.id, status: r.status })),
      );
    }

    if (approved.length === 0) {
      toast.error("No approved allocations in this timeframe.", {
        description:
          "Submissions must be Approved by your manager to appear here.",
      });
      setMatrix([]);
      return;
    }

    const kraMap = new Map<
      string,
      {
        totalPct: number;
        tasks: {
          description: string;
          client: string;
          workType: string;
          pct: number;
          month: string;
        }[];
      }
    >();

    for (const rec of approved) {
      for (const stream of rec.streams) {
        const bucket = kraMap.get(stream.category) ?? {
          totalPct: 0,
          tasks: [],
        };
        for (const act of stream.activities) {
          bucket.totalPct += act.percentage;
          bucket.tasks.push({
            description: act.description || act.workType,
            client: act.client,
            workType: act.workType,
            pct: act.percentage,
            month: rec.month,
          });
        }
        kraMap.set(stream.category, bucket);
      }
    }

    const journalText: string[] = [];
    for (let m = range.fromMonth; m <= range.toMonth; m++) {
      const entries = getEntriesForMonth(currentUser.id, yr, m);
      entries.forEach((e) => journalText.push(e.content));
    }
    const journalCorpus = journalText.join("\n").toLowerCase();

    const monthCount = approved.length;

    const rows: MatrixRow[] = Array.from(kraMap.entries())
      .map(([kra, data]) => {
        const byClient = new Map<
          string,
          { workTypes: Set<string>; pct: number; months: Set<string> }
        >();
        for (const t of data.tasks) {
          const key = t.client || "Internal";
          const v = byClient.get(key) ?? {
            workTypes: new Set<string>(),
            pct: 0,
            months: new Set<string>(),
          };
          v.workTypes.add(t.workType);
          v.pct += t.pct;
          v.months.add(t.month);
          byClient.set(key, v);
        }

        const bullets: string[] = [];
        for (const [client, v] of byClient.entries()) {
          const wts = Array.from(v.workTypes).join(", ").toLowerCase();
          const monthsLabel =
            v.months.size > 1
              ? `over ${v.months.size} months`
              : `in ${Array.from(v.months)[0]}`;
          const journalMention = journalCorpus.includes(client.toLowerCase());
          const evidence = journalMention
            ? " (corroborated by daily journal entries)"
            : "";
          bullets.push(
            `Delivered ${wts} for ${client}, contributing ${v.pct.toFixed(1)}% of total effort ${monthsLabel}${evidence}.`,
          );
        }

        const avgPct = data.totalPct / monthCount;
        const status: MatrixRow["status"] =
          avgPct >= STATUS_THRESHOLDS.delivered ? "Delivered"
          : avgPct >= STATUS_THRESHOLDS.onTrack ? "On-Track"
          : "At-Risk";

        return {
          kra,
          focus: `Drive outcomes across ${kra} workstreams for assigned clients and internal initiatives.`,
          actualBullets: bullets,
          status,
          weight: parseFloat(avgPct.toFixed(1)),
        };
      })
      .sort((a, b) => b.weight - a.weight);

    setMatrix(rows);
    setGeneratedAt(new Date().toLocaleString());
    toast.success(
      `Generated accomplishment matrix from ${approved.length} approved record(s).`,
    );
  };

  const handlePrint = () => window.print();

  const statusBadge = (s: MatrixRow["status"]) =>
    s === "Delivered" ? "bg-success/10 text-success"
    : s === "On-Track"  ? "bg-info/10 text-info"
    :                     "bg-destructive/10 text-destructive";

  return (
    <>
    <WorkspaceTipModal {...getOnboardingGuide("performance-summary")} />
    <div className="p-6 space-y-6 h-[calc(100vh-3rem)] overflow-y-auto">
      <div className="no-print space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Performance Evaluation
            </h1>
            <p className="text-sm text-muted-foreground">
              Generate your accomplishment matrix from approved allocations.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 flex items-end justify-between flex-wrap gap-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Timeframe
                </label>
                <Select
                  value={timeframe}
                  onValueChange={(v) => setTimeframe(v as Timeframe)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TIMEFRAME_RANGES) as Timeframe[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t} ({TIMEFRAME_RANGES[t].label})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Year
                </label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["2024", "2025", "2026"].map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              {matrix && matrix.length > 0 && (
                <Button variant="outline" onClick={handlePrint} className="gap-2">
                  <Printer className="h-4 w-4" /> Print / Export PDF
                </Button>
              )}
              <Button
                onClick={generate}
                className="gap-2 bg-gradient-to-r from-primary to-primary/80 shadow-md shadow-primary/20"
              >
                <Sparkles className="h-4 w-4" /> Generate Accomplishment Report
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="print-area space-y-4">
        {matrix === null ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Sparkles className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">Ready when you are</p>
              <p className="text-sm text-center max-w-md">
                Select a timeframe and click{" "}
                <span className="font-medium">Generate Accomplishment Report</span>{" "}
                to synthesize your approved work into an HR-ready matrix.
              </p>
            </CardContent>
          </Card>
        ) : matrix.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <FileText className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No approved records</p>
              <p className="text-sm">
                No allocations were approved for {timeframe} {year}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="hidden print:block mb-4">
              <h1 className="text-2xl font-bold">Accomplishment Report</h1>
              <p className="text-sm">
                {currentUser?.firstName} {currentUser?.lastName} ·{" "}
                {currentUser?.team} · {currentUser?.jobTitle}
              </p>
              <p className="text-sm">
                Period: {timeframe} {year} ({TIMEFRAME_RANGES[timeframe].label}) ·
                Generated: {generatedAt}
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Accomplishment Matrix — {timeframe} {year}
                  </span>
                  <span className="text-xs text-muted-foreground font-normal no-print">
                    {matrix.length} Key Result Areas
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[18%]">Key Result Area</TableHead>
                      <TableHead className="w-[22%]">Target Work / Focus</TableHead>
                      <TableHead className="w-[45%]">
                        Actual Delivery (AI-synthesized)
                      </TableHead>
                      <TableHead className="w-[8%] text-right">Weight</TableHead>
                      <TableHead className="w-[12%]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matrix.map((row, i) => (
                      <TableRow key={i} className="align-top">
                        <TableCell className="font-semibold">{row.kra}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.focus}
                        </TableCell>
                        <TableCell>
                          <ul className="list-disc pl-4 space-y-1 text-sm">
                            {row.actualBullets.map((b, j) => (
                              <li key={j}>{b}</li>
                            ))}
                          </ul>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary tabular-nums">
                          {row.weight}%
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadge(row.status)}>
                            {row.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground no-print">
              <Sparkles className="h-3 w-3 inline mr-1" />
              Bullets are AI-synthesized from approved allocations and
              corroborated by daily journal entries where available.
            </p>
          </>
        )}
      </div>
    </div>
    </>
  );
};

export default PerformanceReview;
