import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// ReopenAllocationDialog — Admin-only escape hatch on the Employees page.
//
// Lists the employee's APPROVED allocations; the Admin picks one, gives a
// reason, and the record moves back to Pending Review so the manager can edit
// and re-approve it. Approve/return only act on Pending Review, so this is the
// only way to undo an approval. API mode only (the endpoint is server-side).
// ---------------------------------------------------------------------------

interface ReopenAllocationDialogProps {
  employee: { id: string; firstName: string; lastName: string } | null;
  onOpenChange: (open: boolean) => void;
}

export const ReopenAllocationDialog = ({
  employee,
  onOpenChange,
}: ReopenAllocationDialogProps) => {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  const open = employee !== null;

  // Reset the form every time the dialog opens for a (possibly different) employee.
  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setReason("");
    }
  }, [open, employee?.id]);

  const { data: approved = [], isLoading, isError } = useQuery({
    queryKey: ["allocations", "approved-for-reopen", employee?.id],
    queryFn: ({ signal }) =>
      api.allocations.list({ employeeId: employee!.id, status: "Approved" }, signal),
    enabled: open,
    select: (records) =>
      [...records].sort(
        (a, b) =>
          Number(b.year) * 12 + b.monthIndex - (Number(a.year) * 12 + a.monthIndex),
      ),
  });

  const selected = approved.find((r) => r.id === selectedId) ?? null;
  const canSubmit = !!selected && reason.trim().length > 0 && !pending;

  const handleReopen = async () => {
    if (!selected || !employee) return;
    setPending(true);
    try {
      await api.allocations.reopen(selected.id, reason.trim());
      await qc.invalidateQueries({ queryKey: ["allocations"] });
      toast.success("Allocation reopened for review", {
        description: `${employee.firstName}'s ${selected.month} ${selected.year} allocation is back in ${selected.managerName || "the manager"}'s queue.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't reopen this allocation.", {
        description:
          err instanceof ApiError ? err.message : "Something went wrong. Please retry.",
      });
      // The record may have moved under us (409) — refresh the list.
      void qc.invalidateQueries({ queryKey: ["allocations", "approved-for-reopen"] });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reopen Approved Allocation</DialogTitle>
          <DialogDescription>
            Move one of {employee?.firstName} {employee?.lastName}&rsquo;s approved
            allocations back to <span className="font-medium">Pending Review</span>.
            Their manager can then edit and approve it again. The manager and
            employee are notified, and the reason is recorded in the allocation
            history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Approved allocation</Label>
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive">
                Couldn&rsquo;t load allocations. Please try again.
              </p>
            ) : approved.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                This employee has no approved allocations.
              </p>
            ) : (
              <div
                role="radiogroup"
                className="max-h-56 overflow-y-auto scrollbar-modern space-y-1.5"
              >
                {approved.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={selectedId === r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left transition-colors",
                      selectedId === r.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <p className="text-sm font-medium">
                      {r.month} {r.year}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.actionedBy
                        ? `Approved by ${r.actionedBy.userName}`
                        : `Manager: ${r.managerName || "—"}`}
                      {r.reviewedAt &&
                        ` · ${new Date(r.reviewedAt).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        })}`}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reopen-reason">Reason (required)</Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Requested by the manager — changes needed before final approval."
              className="min-h-[90px]"
              maxLength={1000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleReopen} disabled={!canSubmit} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            {pending ? "Reopening…" : "Reopen for Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
