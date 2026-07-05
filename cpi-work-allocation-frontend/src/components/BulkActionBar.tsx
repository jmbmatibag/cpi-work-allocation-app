import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserCog, Bell, BellOff, Mail, Trash2, X } from "lucide-react";

interface BulkActionBarProps {
  /** Number of currently selected rows. The bar shows when > 0. */
  count: number;
  /** Whether API-only actions (resend welcome) are available. */
  isApiMode: boolean;
  /** Disables every action while a bulk mutation is in flight. */
  pending?: boolean;
  /** Open the bulk "change manager" modal. */
  onChangeManager: () => void;
  /** Set the scheduled-reminders exemption for the whole selection. */
  onSetReminders: (exempt: boolean) => void;
  /** Resend the welcome email to the selection (API mode only). */
  onResend: () => void;
  /** Open the bulk delete confirmation. */
  onDelete: () => void;
  /** Clear the current selection. */
  onClear: () => void;
}

/**
 * Floating contextual action bar for datatable multi-select.
 *
 * Renders a glassmorphic pill fixed to the bottom-center of the viewport
 * that slides up when `count > 0` and slides away when the selection is
 * cleared. Actions are icon-only with tooltips to stay compact.
 *
 * The bar stays mounted so both the enter and exit transitions play; while
 * sliding out we keep the last non-zero count on screen so the label
 * doesn't flicker to "0 selected".
 */
export function BulkActionBar({
  count,
  isApiMode,
  pending = false,
  onChangeManager,
  onSetReminders,
  onResend,
  onDelete,
  onClear,
}: BulkActionBarProps) {
  const visible = count > 0;

  // Retain the last real count during the slide-out animation.
  const [displayCount, setDisplayCount] = useState(count);
  useEffect(() => {
    if (count > 0) setDisplayCount(count);
  }, [count]);

  return (
    <div
      // Fixed bottom-center. aria-hidden + pointer-events-none when idle so
      // it never traps focus or intercepts clicks while off-screen.
      aria-hidden={!visible}
      className={[
        "fixed bottom-8 left-1/2 z-50 -translate-x-1/2",
        "transition-all duration-300 ease-out",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-center gap-1 rounded-full py-1.5 pl-4 pr-2",
          "border border-border/60 bg-background/80 shadow-2xl",
          "supports-[backdrop-filter]:bg-background/60 backdrop-blur-xl",
          "dark:border-white/10 dark:bg-zinc-900/80 dark:supports-[backdrop-filter]:bg-zinc-900/70",
        ].join(" ")}
      >
        {/* Selection count */}
        <span className="whitespace-nowrap pr-1 text-sm font-medium tabular-nums text-foreground">
          <span className="font-semibold">{displayCount}</span>{" "}
          <span className="text-muted-foreground">selected</span>
        </span>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Change manager */}
        <IconAction
          label="Change Manager"
          onClick={onChangeManager}
          disabled={pending}
        >
          <UserCog className="h-4 w-4" />
        </IconAction>

        {/* Scheduled reminders — dropdown disambiguates enable vs pause,
            since a plain toggle is ambiguous across a mixed selection. */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  aria-label="Toggle Scheduled Reminders"
                  className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                >
                  <Bell className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Toggle Scheduled Reminders</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="center" className="w-52">
            <DropdownMenuLabel>Scheduled reminders</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSetReminders(false)}>
              <Bell className="mr-2 h-4 w-4" />
              Enable for selection
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSetReminders(true)}>
              <BellOff className="mr-2 h-4 w-4" />
              Pause for selection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Resend welcome email — API mode only */}
        {isApiMode && (
          <IconAction
            label="Resend Welcome Email"
            onClick={onResend}
            disabled={pending}
          >
            <Mail className="h-4 w-4" />
          </IconAction>
        )}

        {/* Delete — destructive, red stroke */}
        <IconAction
          label="Delete Selected"
          onClick={onDelete}
          disabled={pending}
          className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </IconAction>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Clear selection */}
        <IconAction label="Clear selection" onClick={onClear} disabled={pending}>
          <X className="h-4 w-4" />
        </IconAction>
      </div>
    </div>
  );
}

interface IconActionProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Ghost icon button wrapped in a tooltip — the bar's standard action. */
function IconAction({
  label,
  onClick,
  disabled,
  className,
  children,
}: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={[
            "h-9 w-9 rounded-full text-muted-foreground hover:text-foreground",
            className ?? "",
          ].join(" ")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
