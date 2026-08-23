import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, isValid, parseISO } from "date-fns";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Wrench, Save, ExternalLink, AlertTriangle } from "lucide-react";
import {
  useMaintenanceStatus,
  useUpdateMaintenance,
  isApiMode,
} from "@/hooks/useMaintenanceStatus";

const DEFAULT_TITLE = "Scheduled Maintenance";
const DEFAULT_MESSAGE =
  "The CPI Work Allocation app is temporarily unavailable while we perform scheduled maintenance. Please check back shortly.";

/** ISO instant → the `yyyy-MM-ddTHH:mm` local string an <input type="datetime-local"> wants. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return "";
  return format(parsed, "yyyy-MM-dd'T'HH:mm");
}

/** `yyyy-MM-ddTHH:mm` (browser-local) → ISO instant, or null when cleared. */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const parsed = new Date(local);
  return isValid(parsed) ? parsed.toISOString() : null;
}

/**
 * Settings → Maintenance. The Admin-only switch behind the global gate.
 *
 * Flipping "Enable maintenance mode" takes the app away from every
 * non-Admin user within one poll interval (60s) — no rebuild, no deploy.
 * Admins keep normal access and carry a chip in the header while it's on.
 */
const MaintenanceSettingsPanel = () => {
  const { status, isError } = useMaintenanceStatus();
  const updateMutation = useUpdateMaintenance();
  const apiMode = isApiMode();

  // Local draft. Seeded from the server and re-seeded whenever the server
  // copy changes underneath us (another admin, another tab).
  const [enabled, setEnabled] = useState(status.enabled);
  const [title, setTitle] = useState(status.title || DEFAULT_TITLE);
  const [message, setMessage] = useState(status.message || DEFAULT_MESSAGE);
  const [startsAt, setStartsAt] = useState(isoToLocalInput(status.startsAt));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(status.endsAt));

  useEffect(() => {
    setEnabled(status.enabled);
    setTitle(status.title || DEFAULT_TITLE);
    setMessage(status.message || DEFAULT_MESSAGE);
    setStartsAt(isoToLocalInput(status.startsAt));
    setEndsAt(isoToLocalInput(status.endsAt));
  }, [status]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Give the announcement a title.");
      return;
    }
    if (!message.trim()) {
      toast.error("Give the announcement a message.");
      return;
    }

    try {
      const saved = await updateMutation.mutateAsync({
        enabled,
        title: title.trim(),
        message: message.trim(),
        startsAt: localInputToIso(startsAt),
        endsAt: localInputToIso(endsAt),
      });
      toast.success(
        saved.enabled
          ? "Maintenance mode is ON — all non-Admin users now see the announcement."
          : "Maintenance mode is OFF — the app is back for everyone.",
      );
    } catch {
      toast.error("Couldn't save. Check your connection and try again.");
    }
  };

  return (
    <div className="rounded-xl p-6 bg-card text-card-foreground border border-border">
      <div className="flex items-center gap-2 mb-1">
        <Wrench className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-base font-semibold">Maintenance Mode</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Replace the entire app with an announcement page. Admins keep normal
        access; everyone else sees the notice within a minute, without needing
        to reload.
      </p>

      {!apiMode && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            The switch is server-owned and this build is running in local
            (localStorage) mode, so it has nothing to read or write. Run against
            the API to use it.
          </span>
        </div>
      )}

      {isError && apiMode && (
        <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Couldn't reach the maintenance endpoint. The gate fails open — the
            app stays available to everyone until this recovers.
          </span>
        </div>
      )}

      <div className="space-y-6 max-w-lg">
        {/* The switch */}
        <div className="flex items-start justify-between gap-6 rounded-lg border border-border bg-muted/30 px-4 py-3.5">
          <div className="space-y-0.5">
            <Label htmlFor="maintenance-enabled" className="text-sm font-medium">
              Enable maintenance mode
            </Label>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? "Non-Admin users will see the announcement instead of the app."
                : "The app is available to everyone."}
            </p>
          </div>
          <Switch
            id="maintenance-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!apiMode}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={DEFAULT_TITLE}
            maxLength={120}
            disabled={!apiMode}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Message</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={DEFAULT_MESSAGE}
            maxLength={2000}
            rows={4}
            disabled={!apiMode}
          />
          <p className="text-xs text-muted-foreground">
            Line breaks are preserved on the announcement page.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Started at (optional)</Label>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={!apiMode}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Expected back by (optional)</Label>
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={!apiMode}
            />
          </div>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Times are in your browser's timezone. Leave both blank for an
          open-ended window — the page then shows no timing line at all.
        </p>

        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={handleSave}
            disabled={!apiMode || updateMutation.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/maintenance" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Preview page
            </Link>
          </Button>
        </div>

        {status.updatedByName && (
          <p className="text-xs text-muted-foreground">
            Last changed by {status.updatedByName}
            {status.updatedAt && isValid(parseISO(status.updatedAt))
              ? ` on ${format(parseISO(status.updatedAt), "d MMM yyyy, h:mm a")}`
              : ""}
            .
          </p>
        )}
      </div>
    </div>
  );
};

export default MaintenanceSettingsPanel;
