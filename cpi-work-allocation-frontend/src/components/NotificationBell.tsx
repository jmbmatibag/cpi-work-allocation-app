import { useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useNotifications,
  type AppNotification,
} from "@/contexts/NotificationsContext";
import { cn } from "@/lib/utils";

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
  const { notifications, unreadCount, markAsRead, markAllAsRead } =
    useNotifications();

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
            unreadCount > 0 && "text-foreground",
          )}
          aria-label={
            unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "Notifications"
          }
        >
          <Bell className="h-6 w-6" strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground leading-none shadow-sm">
              {unreadCount > 99 ? "99+" : unreadCount}
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
          {unreadCount > 0 && (
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
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Bell className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-sm text-muted-foreground">No notifications yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              You're all caught up!
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="divide-y">
              {notifications.map((n) => {
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
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
