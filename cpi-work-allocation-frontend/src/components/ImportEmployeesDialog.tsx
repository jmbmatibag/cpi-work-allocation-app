/**
 * Two-stage employee CSV import.
 *
 *   upload    -> drop/select the CPI HR export; papaparse it client-side
 *   analyzing -> POST rows to /api/employees/import/analyze (read-only)
 *   review    -> show the plan: metrics, "send welcome email" toggle, issues
 *   executing -> EventSource to /import/execute; live <Progress /> + feed
 *   summary   -> final metrics banner + per-row failures
 *
 * The dialog owns the whole lifecycle. On a successful run it calls
 * onComplete() so the parent can refetch the directory.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Mail,
  Users,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/apiClient";
import type {
  AnalyzeResponse,
  ExecuteComplete,
  ExecuteProgress,
} from "@/lib/employeeImportTypes";

const REQUIRED_HEADERS = [
  "Surname",
  "First Name",
  "CPI Email",
  "Assignment",
  "Immediate Supervisor",
] as const;

type Stage = "upload" | "analyzing" | "review" | "executing" | "summary";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful import so the parent can refetch the directory. */
  onComplete?: () => void;
}

export function ImportEmployeesDialog({ open, onClose, onComplete }: Props) {
  const [stage, setStage] = useState<Stage>("upload");
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ExecuteProgress | null>(null);
  const [result, setResult] = useState<ExecuteComplete | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const reset = useCallback(() => {
    closeStream();
    setStage("upload");
    setAnalysis(null);
    setSendEmail(true);
    setDragging(false);
    setProgress(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [closeStream]);

  // Close any open stream on unmount.
  useEffect(() => closeStream, [closeStream]);

  const handleClose = useCallback(() => {
    // Don't let the user close mid-stream and orphan the EventSource.
    if (stage === "executing") return;
    reset();
    onClose();
  }, [stage, reset, onClose]);

  const analyze = useCallback(async (file: File) => {
    if (!/\.csv$/i.test(file.name)) {
      toast.error("Please upload a .csv file.");
      return;
    }
    setStage("analyzing");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: async (parsed) => {
        const headers = parsed.meta.fields ?? [];
        const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
        if (missing.length > 0) {
          toast.error(`CSV is missing required column(s): ${missing.join(", ")}.`);
          setStage("upload");
          return;
        }
        const rows = parsed.data.filter((r) =>
          Object.values(r).some((v) => (v ?? "").toString().trim() !== ""),
        );
        if (rows.length === 0) {
          toast.error("No data rows found in the CSV.");
          setStage("upload");
          return;
        }
        try {
          const res = await api.employees.analyzeImport(rows);
          setAnalysis(res);
          setStage("review");
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : "Failed to analyze the CSV.",
          );
          setStage("upload");
        }
      },
      error: (err) => {
        toast.error(`Could not read the CSV: ${err.message}`);
        setStage("upload");
      },
    });
  }, []);

  const execute = useCallback(() => {
    if (!analysis) return;
    setProgress({ phase: "create", processed: 0, total: analysis.summary.toCreate, message: "Starting…" });
    setStage("executing");

    const es = new EventSource(api.employees.importExecuteUrl(analysis.jobId, sendEmail), {
      withCredentials: true,
    });
    esRef.current = es;

    es.addEventListener("progress", (e) => {
      setProgress(JSON.parse((e as MessageEvent).data) as ExecuteProgress);
    });
    es.addEventListener("complete", (e) => {
      setResult(JSON.parse((e as MessageEvent).data) as ExecuteComplete);
      setStage("summary");
      closeStream();
      onComplete?.();
    });
    es.addEventListener("failed", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { message: string };
      toast.error(data.message);
      setStage("summary");
      closeStream();
      onComplete?.(); // some rows may have been created — refetch regardless
    });
    es.onerror = () => {
      // Fires on network drop OR a non-200 (expired job / auth). If we already
      // reached summary this is just the normal close — ignore it.
      setStage((s) => {
        if (s === "executing") {
          toast.error("Lost connection to the import stream. Please re-analyze and try again.");
          closeStream();
          return "review";
        }
        return s;
      });
    };
  }, [analysis, sendEmail, closeStream, onComplete]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void analyze(file);
  };

  const pct = progress && progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Import Employees</DialogTitle>
          <DialogDescription>
            Upload the CPI HR employee export (.csv). We&apos;ll validate it and
            show you exactly what will happen before anything is created.
          </DialogDescription>
        </DialogHeader>

        {/* ---------- UPLOAD ---------- */}
        {stage === "upload" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-12 text-center transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <UploadCloud className="h-10 w-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Drag &amp; drop your CSV here, or click to browse
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Expected columns: No., Employee Number, Surname, First Name,
                Middle Name, CPI Email, Assignment, Immediate Supervisor
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void analyze(file);
              }}
            />
          </div>
        )}

        {/* ---------- ANALYZING ---------- */}
        {stage === "analyzing" && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analyzing your file…</p>
          </div>
        )}

        {/* ---------- REVIEW ---------- */}
        {stage === "review" && analysis && (
          <ReviewPanel
            analysis={analysis}
            sendEmail={sendEmail}
            onToggleEmail={setSendEmail}
          />
        )}

        {/* ---------- EXECUTING ---------- */}
        {stage === "executing" && (
          <div className="space-y-3 py-8">
            <Progress value={pct} />
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress?.message ?? "Working…"}
              </span>
              <span className="tabular-nums text-muted-foreground">{pct}%</span>
            </div>
          </div>
        )}

        {/* ---------- SUMMARY ---------- */}
        {stage === "summary" && result && <SummaryPanel result={result} />}

        <DialogFooter>
          {stage === "review" && analysis && (
            <>
              <Button variant="outline" size="sm" onClick={reset}>
                Choose a different file
              </Button>
              <Button
                size="sm"
                disabled={analysis.summary.toCreate === 0}
                onClick={execute}
              >
                Proceed with Import ({analysis.summary.toCreate})
              </Button>
            </>
          )}
          {stage === "summary" && (
            <Button size="sm" onClick={handleClose}>
              Done
            </Button>
          )}
          {(stage === "upload" || stage === "analyzing") && (
            <Button variant="outline" size="sm" onClick={handleClose}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card p-2.5">
      {icon}
      <div className="leading-tight">
        <p className="text-lg font-semibold text-foreground">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function ReviewPanel({
  analysis,
  sendEmail,
  onToggleEmail,
}: {
  analysis: AnalyzeResponse;
  sendEmail: boolean;
  onToggleEmail: (v: boolean) => void;
}) {
  const { summary, rows } = analysis;
  const flagged = rows.filter((r) => r.status === "error" || r.warnings.length > 0);

  return (
    <div className="space-y-4 pt-1">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="To import" value={summary.toCreate} />
        <Metric icon={<Users className="h-4 w-4 text-sky-500" />} label="New managers" value={summary.newManagers} />
        <Metric icon={<Mail className="h-4 w-4 text-violet-500" />} label="Emails" value={sendEmail ? summary.emailsToSend : 0} />
        <Metric icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} label="Invalid" value={summary.invalid} />
      </div>

      {(summary.alreadyExists > 0 || summary.missingSupervisors > 0) && (
        <p className="text-xs text-muted-foreground">
          {summary.alreadyExists > 0 &&
            `${summary.alreadyExists} already in the directory (skipped). `}
          {summary.missingSupervisors > 0 &&
            `${summary.missingSupervisors} supervisor name(s) couldn't be matched.`}
        </p>
      )}

      <label className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
        <Checkbox
          checked={sendEmail}
          onCheckedChange={(c) => onToggleEmail(c === true)}
          className="mt-0.5"
        />
        <span className="text-sm">
          <span className="font-medium text-foreground">
            Send welcome email to new employees
          </span>
          <span className="block text-xs text-muted-foreground">
            Each new employee gets a one-time password-setup link (valid 24h).
          </span>
        </span>
      </label>

      {flagged.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {flagged.length} row(s) need attention
          </p>
          <ScrollArea className="h-48 rounded-md border">
            <ul className="divide-y text-sm">
              {flagged.map((r) => (
                <li key={r.index} className="flex items-start gap-2 p-2.5">
                  <Badge
                    variant={r.status === "error" ? "destructive" : "secondary"}
                    className="mt-0.5 shrink-0"
                  >
                    Row {r.index}
                  </Badge>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {r.raw["First Name"]} {r.raw["Surname"]}{" "}
                      <span className="font-normal text-muted-foreground">
                        {r.raw["CPI Email"]}
                      </span>
                    </p>
                    {[...r.errors, ...r.warnings].map((msg, i) => (
                      <p
                        key={i}
                        className={
                          r.errors.includes(msg)
                            ? "text-destructive"
                            : "text-amber-600 dark:text-amber-500"
                        }
                      >
                        {msg}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> All rows look good — ready to import.
        </p>
      )}
    </div>
  );
}

function SummaryPanel({ result }: { result: ExecuteComplete }) {
  return (
    <div className="space-y-4 pt-1">
      <div className="grid grid-cols-3 gap-2">
        <Metric icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Imported" value={result.imported} />
        <Metric icon={<Mail className="h-4 w-4 text-violet-500" />} label="Emails sent" value={result.emailsSent} />
        <Metric icon={<XCircle className="h-4 w-4 text-destructive" />} label="Failed" value={result.failed.length} />
      </div>

      <p className="text-xs text-muted-foreground">
        {result.linked} report{result.linked === 1 ? "" : "s"} linked to a manager
        {result.skippedExisting > 0 && ` · ${result.skippedExisting} already existed`}
        {result.invalid > 0 && ` · ${result.invalid} invalid row(s) skipped`}.
      </p>

      {result.failed.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            These rows could not be created — fix them and re-import:
          </p>
          <ScrollArea className="h-40 rounded-md border">
            <ul className="divide-y text-sm">
              {result.failed.map((f, i) => (
                <li key={i} className="p-2.5">
                  <p className="font-medium text-foreground">
                    {f.name}{" "}
                    <span className="font-normal text-muted-foreground">{f.email}</span>
                  </p>
                  <p className="text-destructive">{f.reason}</p>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
