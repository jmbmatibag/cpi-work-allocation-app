import { useState } from "react";
import { FileText, FileSpreadsheet, FileDown, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ALL_EXPORT_COLUMNS,
  EXPORT_COLUMN_LABELS,
  type ExportColumn,
  type ExportFormat,
  type ExportGrouping,
  type ExportOptions,
} from "@/lib/exports/types";

export interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  filtersSummary: string;
  scopeLabel: string;
  scopeSlug: string;
  rowCount: number;
  onExport: (options: ExportOptions) => void;
}

const PDF_ENABLED = false;

export const ExportModal = ({
  open,
  onClose,
  filtersSummary,
  scopeLabel,
  scopeSlug,
  rowCount,
  onExport,
}: ExportModalProps) => {
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [grouping, setGrouping] = useState<ExportGrouping>("flat");
  const [columns, setColumns] = useState<Set<ExportColumn>>(
    () => new Set<ExportColumn>(ALL_EXPORT_COLUMNS),
  );

  const toggleColumn = (col: ExportColumn) => {
    setColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const handleSubmit = () => {
    const orderedColumns = ALL_EXPORT_COLUMNS.filter((c) => columns.has(c));
    if (orderedColumns.length === 0) return;
    onExport({ format, grouping, columns: orderedColumns, scopeLabel, scopeSlug, filtersSummary });
  };

  const canExport = columns.size > 0 && rowCount > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Export Allocations</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 pt-1">
              <div className="rounded-md px-3 py-2 text-[13px] space-y-1 bg-muted/60 border border-border">
                <div className="text-muted-foreground">
                  Exporting{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {rowCount}
                  </span>{" "}
                  {rowCount === 1 ? "row" : "rows"}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  <span className="font-medium">{scopeLabel}</span>
                  {filtersSummary && (
                    <>
                      <span className="mx-1.5">·</span>
                      {filtersSummary}
                    </>
                  )}
                </div>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Format */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Format
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <FormatButton
                active={format === "csv"}
                onClick={() => setFormat("csv")}
                icon={FileText}
                label="CSV"
                hint="Comma-separated"
              />
              <FormatButton
                active={format === "xlsx"}
                onClick={() => setFormat("xlsx")}
                icon={FileSpreadsheet}
                label="XLSX"
                hint="Excel workbook"
              />
              <FormatButton
                active={format === "pdf"}
                onClick={() => PDF_ENABLED && setFormat("pdf")}
                icon={FileDown}
                label="PDF"
                hint={PDF_ENABLED ? "Portable document" : "Coming soon"}
                disabled={!PDF_ENABLED}
              />
            </div>
          </div>

          {/* Grouping */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Grouping
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <GroupingButton active={grouping === "flat"} onClick={() => setGrouping("flat")} label="Flat" hint="One row per activity" />
              <GroupingButton active={grouping === "employee"} onClick={() => setGrouping("employee")} label="By employee" hint="Header + activities" />
              <GroupingButton active={grouping === "team"} onClick={() => setGrouping("team")} label="By team" hint="Header + activities" />
            </div>
          </div>

          {/* Columns */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Columns
              </Label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setColumns(new Set(ALL_EXPORT_COLUMNS))}
                  className="text-primary transition-colors hover:opacity-70"
                >
                  All
                </button>
                <span className="text-muted-foreground/60">·</span>
                <button
                  type="button"
                  onClick={() => setColumns(new Set())}
                  className="text-primary transition-colors hover:opacity-70"
                >
                  None
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-2.5 rounded-md bg-muted/40 border border-border">
              {ALL_EXPORT_COLUMNS.map((col) => (
                <ColumnCheckbox
                  key={col}
                  checked={columns.has(col)}
                  onToggle={() => toggleColumn(col)}
                  label={EXPORT_COLUMN_LABELS[col]}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canExport} size="sm">
            Export {format.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------- Internal UI bits ----------

const FormatButton = ({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
  hint: string;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "flex flex-col items-center justify-center gap-1 p-3 rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed border",
      active
        ? "bg-primary/10 border-primary text-primary ring-2 ring-primary/20"
        : "bg-card border-border text-foreground hover:bg-muted/50",
    )}
  >
    <Icon className="h-5 w-5" />
    <span className="text-[13px] font-semibold">{label}</span>
    <span className={cn("text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
      {hint}
    </span>
  </button>
);

const GroupingButton = ({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex flex-col items-start gap-0.5 px-3 py-2 rounded-md transition-all text-left border",
      active
        ? "bg-primary/10 border-primary text-primary"
        : "bg-card border-border text-foreground hover:bg-muted/50",
    )}
  >
    <span className="text-[13px] font-semibold">{label}</span>
    <span className={cn("text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
      {hint}
    </span>
  </button>
);

const ColumnCheckbox = ({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={onToggle}
    className="flex items-center gap-2 px-2 py-1.5 rounded text-left text-[12.5px] text-foreground transition-colors hover:bg-muted/60"
  >
    <div
      className={cn(
        "w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors",
        checked
          ? "bg-primary border border-primary text-primary-foreground"
          : "bg-transparent border border-border",
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </div>
    <span>{label}</span>
  </button>
);
