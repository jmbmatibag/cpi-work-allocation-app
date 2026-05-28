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
import {
  ALL_EXPORT_COLUMNS,
  EXPORT_COLUMN_LABELS,
  type ExportColumn,
  type ExportFormat,
  type ExportGrouping,
  type ExportOptions,
} from "@/lib/exports/types";

/**
 * Modal for Finance / admin to configure an export of the current
 * Master Overview view. Scope is implicit ("what I see"); this modal
 * collects only format + grouping + columns + title.
 *
 * On submit, calls `onExport(options)` with a fully-formed
 * ExportOptions. The parent owns the actual file generation + download
 * so this component stays presentational.
 */

export interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Summary of active filters on the Master Overview, shown at the
   * top of the modal so users know what they're about to export.
   */
  filtersSummary: string;
  /** Scope label for title + filename. e.g. "Apr 2026 · IT/Platforms". */
  scopeLabel: string;
  /** Filename-safe slug. e.g. "apr-2026-it-platforms". */
  scopeSlug: string;
  /** Number of rows that will be included (for the button label). */
  rowCount: number;
  /** Called with the chosen options; parent handles the actual export. */
  onExport: (options: ExportOptions) => void;
}

// PDF is wired in Turn 12; for now the button is disabled.
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
    // Preserve declaration order regardless of toggle sequence —
    // ALL_EXPORT_COLUMNS is the canonical ordering used by writers.
    const orderedColumns = ALL_EXPORT_COLUMNS.filter((c) => columns.has(c));
    if (orderedColumns.length === 0) return;
    onExport({
      format,
      grouping,
      columns: orderedColumns,
      scopeLabel,
      scopeSlug,
      filtersSummary,
    });
  };

  const canExport = columns.size > 0 && rowCount > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Export Allocations</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 pt-1">
              <div
                className="rounded-md px-3 py-2 text-[13px] space-y-1"
                style={{
                  background: "hsl(220 14% 97%)",
                  border: "1px solid hsl(220 13% 91%)",
                }}
              >
                <div style={{ color: "hsl(220 10% 45%)" }}>
                  Exporting{" "}
                  <span
                    className="font-semibold tabular-nums"
                    style={{ color: "hsl(222 20% 15%)" }}
                  >
                    {rowCount}
                  </span>{" "}
                  {rowCount === 1 ? "row" : "rows"}
                </div>
                <div
                  className="text-[12px]"
                  style={{ color: "hsl(220 10% 55%)" }}
                >
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
            <Label className="text-xs font-medium uppercase tracking-wider">
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
            <Label className="text-xs font-medium uppercase tracking-wider">
              Grouping
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <GroupingButton
                active={grouping === "flat"}
                onClick={() => setGrouping("flat")}
                label="Flat"
                hint="One row per activity"
              />
              <GroupingButton
                active={grouping === "employee"}
                onClick={() => setGrouping("employee")}
                label="By employee"
                hint="Header + activities"
              />
              <GroupingButton
                active={grouping === "team"}
                onClick={() => setGrouping("team")}
                label="By team"
                hint="Header + activities"
              />
            </div>
          </div>

          {/* Columns */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium uppercase tracking-wider">
                Columns
              </Label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setColumns(new Set(ALL_EXPORT_COLUMNS))}
                  className="transition-colors"
                  style={{ color: "hsl(224 72% 45%)" }}
                >
                  All
                </button>
                <span style={{ color: "hsl(220 8% 60%)" }}>·</span>
                <button
                  type="button"
                  onClick={() => setColumns(new Set())}
                  className="transition-colors"
                  style={{ color: "hsl(224 72% 45%)" }}
                >
                  None
                </button>
              </div>
            </div>
            <div
              className="grid grid-cols-2 gap-1.5 p-2.5 rounded-md"
              style={{
                background: "hsl(220 14% 97%)",
                border: "1px solid hsl(220 13% 91%)",
              }}
            >
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
          <Button
            onClick={handleSubmit}
            disabled={!canExport}
            size="sm"
            style={
              canExport
                ? { background: "hsl(224 72% 45%)", color: "white" }
                : undefined
            }
          >
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
    className="flex flex-col items-center justify-center gap-1 p-3 rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
    style={{
      background: active ? "hsl(224 72% 95%)" : "hsl(0 0% 100%)",
      border: `1px solid ${
        active ? "hsl(224 72% 55%)" : "hsl(220 13% 88%)"
      }`,
      color: active ? "hsl(224 72% 30%)" : "hsl(222 20% 25%)",
      boxShadow: active
        ? "0 0 0 3px hsl(224 72% 92%)"
        : "0 1px 2px 0 hsl(220 13% 90% / 0.3)",
    }}
  >
    <Icon className="h-5 w-5" />
    <span className="text-[13px] font-semibold">{label}</span>
    <span
      className="text-[11px]"
      style={{ color: active ? "hsl(224 50% 45%)" : "hsl(220 10% 50%)" }}
    >
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
    className="flex flex-col items-start gap-0.5 px-3 py-2 rounded-md transition-all text-left"
    style={{
      background: active ? "hsl(224 72% 95%)" : "hsl(0 0% 100%)",
      border: `1px solid ${
        active ? "hsl(224 72% 55%)" : "hsl(220 13% 88%)"
      }`,
      color: active ? "hsl(224 72% 30%)" : "hsl(222 20% 25%)",
    }}
  >
    <span className="text-[13px] font-semibold">{label}</span>
    <span
      className="text-[11px]"
      style={{ color: active ? "hsl(224 50% 45%)" : "hsl(220 10% 50%)" }}
    >
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
    className="flex items-center gap-2 px-2 py-1.5 rounded text-left text-[12.5px] transition-colors"
    style={{ color: "hsl(222 20% 15%)" }}
    onMouseEnter={(e) =>
      (e.currentTarget.style.background = "hsl(220 14% 93%)")
    }
    onMouseLeave={(e) =>
      (e.currentTarget.style.background = "transparent")
    }
  >
    <div
      className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors"
      style={{
        background: checked ? "hsl(224 72% 45%)" : "transparent",
        border: checked
          ? "1px solid hsl(224 72% 45%)"
          : "1px solid hsl(220 13% 85%)",
        color: "hsl(0 0% 100%)",
      }}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </div>
    <span>{label}</span>
  </button>
);
