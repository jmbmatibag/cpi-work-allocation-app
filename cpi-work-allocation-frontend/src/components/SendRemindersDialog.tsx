import { useState, useEffect, useMemo } from "react";
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
import { Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/apiClient";
import { ApiError } from "@/lib/apiClient";

/**
 * One delinquent manager — a manager whose team is not yet 100% approved
 * for the selected period. Derived in CompanyMasterOverview from the team
 * summary aggregation.
 */
export interface DelinquentManager {
  managerId: string;
  managerName: string;
  teams: string[];
  /** Total headcount across this manager's groups. */
  total: number;
  /** Allocations still not approved (the reminder is about these). */
  outstanding: number;
}

interface SendRemindersDialogProps {
  open: boolean;
  onClose: () => void;
  managers: DelinquentManager[];
  month: string;
  year: string;
}

/**
 * Manual Reminder System (Epic 2).
 *
 * Finance ticks the managers who still owe approvals and fires a single
 * POST /api/notifications/manual-reminder with the selected manager ids.
 * The backend resolves each manager's email and sends the overdue-reminder
 * template. All managers start pre-selected — the common case is "remind
 * everyone who's behind".
 */
export const SendRemindersDialog = ({
  open,
  onClose,
  managers,
  month,
  year,
}: SendRemindersDialogProps) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  // Re-seed the selection (all managers checked) every time the dialog
  // opens or the underlying list changes.
  useEffect(() => {
    if (open) setSelected(new Set(managers.map((m) => m.managerId)));
  }, [open, managers]);

  const allSelected = managers.length > 0 && selected.size === managers.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === managers.length
        ? new Set()
        : new Set(managers.map((m) => m.managerId)),
    );
  };

  const selectedCount = selected.size;

  const totalOutstanding = useMemo(
    () =>
      managers
        .filter((m) => selected.has(m.managerId))
        .reduce((sum, m) => sum + m.outstanding, 0),
    [managers, selected],
  );

  const handleSend = async () => {
    const ids = managers
      .map((m) => m.managerId)
      .filter((id) => selected.has(id));
    if (ids.length === 0) return;

    setSending(true);
    try {
      const result = await api.notifications.manualReminder(ids, month, year);
      const sentCount = result.sent.length;
      const skippedCount = result.skipped.length;
      if (sentCount > 0) {
        toast.success(
          `Sent ${sentCount} reminder${sentCount === 1 ? "" : "s"} for ${month} ${year}.` +
            (skippedCount > 0 ? ` ${skippedCount} skipped (no email on file).` : ""),
        );
      } else {
        toast.warning(
          `No reminders sent — ${skippedCount} manager${
            skippedCount === 1 ? " has" : "s have"
          } no email on file.`,
        );
      }
      onClose();
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
      toast.error(`Could not send reminders: ${message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Send Reminders
          </DialogTitle>
          <DialogDescription>
            Email the managers whose teams are not yet fully approved for{" "}
            <strong>
              {month} {year}
            </strong>
            . They&apos;ll receive an &ldquo;Action Required&rdquo; notice for
            their outstanding allocations.
          </DialogDescription>
        </DialogHeader>

        {managers.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            🎉 Every team is fully approved for {month} {year}. No reminders
            needed.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b pb-2">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-medium text-primary hover:underline"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
              <span className="text-xs text-muted-foreground">
                {selectedCount} of {managers.length}{" "}
                {managers.length === 1 ? "manager" : "managers"}
                {totalOutstanding > 0 ? (
                  <>
                    {" · "}
                    <span className="text-warning">
                      {totalOutstanding} outstanding
                    </span>
                  </>
                ) : (
                  ""
                )}
              </span>
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {managers.map((m) => {
                const checked = selected.has(m.managerId);
                return (
                  <label
                    key={m.managerId}
                    className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(m.managerId)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {m.managerName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.teams.join(", ")}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-warning/40 text-warning"
                    >
                      {m.outstanding} outstanding
                    </Badge>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={managers.length === 0 || selectedCount === 0 || sending}
            className="gap-2"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4" /> Send {selectedCount}{" "}
                {selectedCount === 1 ? "Reminder" : "Reminders"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
