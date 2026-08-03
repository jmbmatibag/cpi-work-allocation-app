import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  AlertCircle,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useNotifications,
  type AppNotification,
} from "@/contexts/NotificationsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAllocations } from "@/contexts/AllocationsContext";
import { cn } from "@/lib/utils";

/**
 * Content token the employee "please submit" reminder embeds (written by
 * `useNotificationScheduler` and the backend). Matching on this phrase — not
 * on the generic "Action Required" title — keeps the failsafe from touching
 * manager "Pending Actions" or the Finance "Overdue Work Allocations" nudge,
 * both of which are about a whole team rather than this one allocation.
 */
const SUBMIT_REMINDER_TOKEN = "submit your work allocation";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const TYPE_ICON: Record<
  AppNotification["type"],
  { icon: React.ElementType; className: string }
> = {
  info:    { icon: Info,          className: "text-info" },
  success: { icon: CheckCircle2,  className: "text-success" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  error:   { icon: AlertCircle,   className: "text-destructive" },
};

const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { notifications, markAsRead, markAllAsRead } = useNotifications();
  const { currentUser } = useAuth();
  const { records } = useAllocations();

  // Epic 3 — failsafe. Build the set of "{Month} {Year}" periods for which the
  // current user's OWN allocation is already settled (submitted or approved),
  // so a "please submit" reminder for that period can be treated as stale.
  // This is the last line of defense: even if a rogue reminder slips past the
  // generator (Epic 1) and the approval cleanup (Epic 2), the UI never shows
  // an actionable submit nudge for a period the local state knows is handled.
  const settledPeriods = useMemo(() => {
    const set = new Set<string>();
    if (!currentUser) return set;
    for (const r of records) {
      if (
        r.employeeId === currentUser.id &&
        (r.status === "Approved" || r.status === "Pending Review")
      ) {
        set.add(`${r.month} ${r.year}`);
      }
    }
    return set;
  }, [records, currentUser]);

  const isStaleSubmitReminder = useCallback(
    (n: AppNotification): boolean => {
      if (!n.message.includes(SUBMIT_REMINDER_TOKEN)) return false;
      for (const period of settledPeriods) {
        if (n.message.includes(period)) return true;
      }
      return false;
    },
    [settledPeriods],
  );

  // Visually suppress stale submit reminders from the tray.
  const visibleNotifications = useMemo(
    () => notifications.filter((n) => !isStaleSubmitReminder(n)),
    [notifications, isStaleSubmitReminder],
  );

  // ...and actively dismiss any that are still unread, so they clear from the
  // unread badge and (in API mode) get marked read server-side too. Runs as
  // an effect — never mutate notification state during render.
  useEffect(() => {
    for (const n of notifications) {
      if (!n.isRead && isStaleSubmitReminder(n)) markAsRead(n.id);
    }
  }, [notifications, isStaleSubmitReminder, markAsRead]);

  const visibleUnreadCount = useMemo(
    () => visibleNotifications.filter((n) => !n.isRead).length,
    [visibleNotifications],
  );

  const handleItemClick = (n: AppNotification) => {
    if (!n.isRead) markAsRead(n.id);
    if (n.actionUrl) {
      navigate(n.actionUrl);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex items-center justify-center h-10 w-10 mr-2 rounded-md transition-colors hover:bg-accent",
            visibleUnreadCount > 0 && "text-foreground",
          )}
          aria-label={
            visibleUnreadCount > 0
              ? `${visibleUnreadCount} unread notification${visibleUnreadCount === 1 ? "" : "s"}`
              : "Notifications"
          }
        >
          <Bell className="h-6 w-6" strokeWidth={1.75} />
          {visibleUnreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground leading-none shadow-sm">
              {visibleUnreadCount > 99 ? "99+" : visibleUnreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[360px] p-0 shadow-lg"
        sideOffset={6}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Notifications</span>
          {visibleUnreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
              onClick={markAllAsRead}
            >
              <Check className="h-3 w-3" />
              Mark all as read
            </Button>
          )}
        </div>

        {/* List */}
        {visibleNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Bell className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-sm text-muted-foreground">No notifications yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              You're all caught up!
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "max-h-[400px] overflow-y-auto scroll-smooth overscroll-contain",
              // Minimal, unobtrusive scrollbar (no plugin needed).
              "[&::-webkit-scrollbar]:w-1.5",
              "[&::-webkit-scrollbar-track]:bg-transparent",
              "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
            )}
          >
            <div className="divide-y">
              {visibleNotifications.map((n) => {
                const { icon: Icon, className: iconClass } = TYPE_ICON[n.type];
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/40",
                      n.isRead && "opacity-60",
                    )}
                    onClick={() => handleItemClick(n)}
                  >
                    <Icon
                      className={cn("h-4 w-4 mt-0.5 shrink-0", iconClass)}
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={cn(
                            "text-sm leading-tight",
                            !n.isRead && "font-semibold",
                          )}
                        >
                          {n.title}
                        </p>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 mt-0.5">
                          {relativeTime(n.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                        {n.message}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 hover:!opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                        aria-label="Mark as read"
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsRead(n.id);
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
