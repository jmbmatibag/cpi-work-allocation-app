import { Send, AlertCircle, CheckCircle2, Pencil, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApiAllocationHistoryEvent } from "@/lib/apiClient";

// ---------------------------------------------------------------------------
// AllocationTimeline — a minimal, premium vertical activity log (Vercel /
// Linear style) for one allocation's lifecycle.
//
// Purely presentational: it receives the events (newest first) plus the
// loading / error flags and renders a vertical line connecting event nodes.
// Data fetching + the side-panel chrome live in <AllocationHistorySheet>.
// ---------------------------------------------------------------------------

type EventType = ApiAllocationHistoryEvent["eventType"];

// Per-event visual language. Verbs read as "<verb> <actor>" ("Approved by
// Andrew Robes"). Tones are deliberately muted — the icon carries the color,
// the text stays neutral, matching the app's activity-log style.
const EVENT_CONFIG: Record<
  EventType,
  { icon: typeof Send; verb: string; iconClass: string; ringClass: string }
> = {
  SUBMITTED: {
    icon: Send,
    verb: "Submitted by",
    iconClass: "text-blue-500",
    ringClass: "border-blue-500/20 bg-blue-500/5",
  },
  REVISION_REQUESTED: {
    icon: AlertCircle,
    verb: "Revision requested by",
    iconClass: "text-amber-500",
    ringClass: "border-amber-500/20 bg-amber-500/5",
  },
  APPROVED: {
    icon: CheckCircle2,
    verb: "Approved by",
    iconClass: "text-emerald-500",
    ringClass: "border-emerald-500/20 bg-emerald-500/5",
  },
  EDITED: {
    icon: Pencil,
    verb: "Edited by",
    iconClass: "text-muted-foreground",
    ringClass: "border-border bg-muted/40",
  },
};

// "Today at 3:42 PM" / "Yesterday at 9:10 AM" / "Jun 12, 2026 at 3:42 PM".
function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  if (d.toDateString() === yesterday.toDateString())
    return `Yesterday at ${time}`;

  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${date} at ${time}`;
}

interface AllocationTimelineProps {
  events: ApiAllocationHistoryEvent[];
  isLoading?: boolean;
  isError?: boolean;
}

const AllocationTimeline = ({
  events,
  isLoading,
  isError,
}: AllocationTimelineProps) => {
  if (isLoading) {
    return (
      <div className="space-y-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t load the activity history. Please try again.
      </p>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-muted/40">
          <Clock className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          No activity yet. Events appear here once the allocation is submitted.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative">
      {events.map((event, i) => {
        const config = EVENT_CONFIG[event.eventType];
        const Icon = config.icon;
        const isLast = i === events.length - 1;
        const actorName = event.actor?.name ?? "System";

        return (
          <li key={event.id} className="relative flex gap-4 pb-7 last:pb-0">
            {/* Connecting line — sits centered under the 32px node, drawn from
                just below one node to the next. Skipped on the last event. */}
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[15px] top-9 h-[calc(100%-1.75rem)] border-l-2 border-muted"
              />
            )}

            {/* Node */}
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                config.ringClass,
              )}
            >
              <Icon className={cn("h-4 w-4", config.iconClass)} />
            </span>

            {/* Body */}
            <div className="flex-1 pt-0.5">
              <p className="text-sm leading-snug text-foreground">
                <span className="text-muted-foreground">{config.verb} </span>
                <span className="font-medium">{actorName}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatEventTime(event.createdAt)}
              </p>

              {/* Comment (revision feedback) — light gray text block. */}
              {event.comment && (
                <p className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground/80 whitespace-pre-line">
                  &ldquo;{event.comment}&rdquo;
                </p>
              )}

              {/* Per-card flags — the specific cards this revision flagged and
                  why. Only present on REVISION_REQUESTED events; sits alongside
                  the summary comment so the timeline shows the full picture. */}
              {event.eventType === "REVISION_REQUESTED" &&
                event.flags &&
                event.flags.length > 0 && (
                  <ul className="list-disc pl-4 text-sm text-muted-foreground mt-2 space-y-0.5">
                    {event.flags.map((f, idx) => (
                      <li key={idx}>
                        <span className="font-medium text-foreground/80">
                          {f.card}
                        </span>
                        {" — "}
                        {f.comment}
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default AllocationTimeline;
