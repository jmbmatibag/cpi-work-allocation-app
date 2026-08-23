import { useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Wrench, Clock, RefreshCw, Mail } from "lucide-react";
import { useMaintenanceStatus } from "@/hooks/useMaintenanceStatus";

// Shown as the "anything urgent" contact. Change this to whichever inbox
// should field questions during a window.
const SUPPORT_EMAIL = "platforms.ticket@cpi.com.ph";

const DEFAULT_TITLE = "Scheduled Maintenance";
const DEFAULT_MESSAGE =
  "The CPI Work Allocation app is temporarily unavailable while we perform scheduled maintenance. Please check back shortly.";

/** ISO string → "24 Aug 2026, 6:00 PM". Returns null for missing/garbage input. */
function formatWindow(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return null;
  return format(parsed, "d MMM yyyy, h:mm a");
}

/**
 * The maintenance announcement. Rendered two ways:
 *
 *  1. by MaintenanceGate, in place of the entire app, whenever maintenance
 *     mode is on and the visitor isn't an Admin;
 *  2. directly at /maintenance, which stays reachable at all times so an
 *     Admin can preview the copy before flipping the switch.
 *
 * Standalone by design — no sidebar, no providers, no session. It has to
 * render for a signed-out visitor whose very first request lands here.
 */
const Maintenance = () => {
  const { status, refetch } = useMaintenanceStatus();
  const [isChecking, setIsChecking] = useState(false);

  const title = status.title.trim() || DEFAULT_TITLE;
  const message = status.message.trim() || DEFAULT_MESSAGE;
  const backBy = formatWindow(status.endsAt);
  const startedAt = formatWindow(status.startsAt);

  const handleCheckAgain = async () => {
    setIsChecking(true);
    try {
      const { data } = await refetch();
      // Maintenance is over — a full reload is the honest way back in. It
      // re-runs the session check and refetches every cache the user's tab
      // has been sitting on since the window started.
      if (data && !data.enabled) {
        window.location.reload();
        return;
      }
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-primary/5 via-primary/3 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-gradient-to-br from-accent/5 to-transparent blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden">
            <img
              src="/cpi-logo.png"
              alt="CPI Logo"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        <div className="glass-card rounded-2xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10 mb-5">
            <Wrench className="h-5 w-5 text-amber-600 dark:text-amber-500" />
          </div>

          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {title}
          </h1>

          <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-line">
            {message}
          </p>

          {(backBy || startedAt) && (
            <div className="mt-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-left">
              {startedAt && (
                <div className="flex items-start gap-2.5 text-[13px]">
                  <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Started{" "}
                    <span className="font-medium text-foreground">{startedAt}</span>
                  </span>
                </div>
              )}
              {backBy && (
                <div
                  className={`flex items-start gap-2.5 text-[13px] ${startedAt ? "mt-2" : ""}`}
                >
                  <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Expected back by{" "}
                    <span className="font-medium text-foreground">{backBy}</span>
                  </span>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleCheckAgain}
            disabled={isChecking}
            variant="outline"
            className="mt-6 gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
            {isChecking ? "Checking…" : "Check again"}
          </Button>

          <p className="mt-6 text-xs text-muted-foreground">
            Anything urgent? Reach the team at{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <Mail className="h-3 w-3" />
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          CPI Work Allocation · Computer Professionals Inc.
        </p>
      </div>
    </div>
  );
};

export default Maintenance;
