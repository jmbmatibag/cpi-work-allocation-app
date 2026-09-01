import { Sparkles, Wrench, Bug, ArrowRightLeft, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PATCH_NOTES,
  PATCH_CHANGE_LABELS,
  formatPatchDate,
  type PatchChangeType,
} from "@/lib/patchNotes";

/**
 * Permanent release history (/whats-new).
 *
 * The counterpart to the one-time PatchNotesModal, in the same spirit as
 * /help vs. the first-run tip modals: content comes from PATCH_NOTES, so a
 * release is written once and appears in both places.
 *
 * Owns its own scroll container per the app-wide layout convention — the
 * shell is pinned to one viewport, so a page that doesn't scroll itself is
 * clipped.
 */

const TYPE_STYLES: Record<
  PatchChangeType,
  { icon: typeof Sparkles; badge: string; iconWrap: string }
> = {
  new: {
    icon: Sparkles,
    badge: "bg-primary/10 text-primary border-primary/20",
    iconWrap: "bg-primary/10 text-primary",
  },
  improved: {
    icon: Wrench,
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    iconWrap: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  fixed: {
    icon: Bug,
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    iconWrap: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  changed: {
    icon: ArrowRightLeft,
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    iconWrap: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
};

const PatchNotesPage = () => {
  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-modern">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <header className="mb-8">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary/10 text-primary p-2">
              <Rocket className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              Patch Updates
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Everything that has shipped, newest first. The most recent release
            also greets you on your Personal Dashboard until you tick
            &ldquo;Do not show again&rdquo;.
          </p>
        </header>

        {PATCH_NOTES.length === 0 ? (
          <p className="text-sm text-muted-foreground">No updates yet.</p>
        ) : (
          <ol className="relative space-y-8">
            {/* Timeline rail. Hidden from screen readers — it's decorative. */}
            <span
              aria-hidden
              className="absolute left-[7px] top-2 bottom-2 w-px bg-border"
            />

            {PATCH_NOTES.map((note) => (
              <li key={note.version} className="relative pl-8">
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-background bg-primary"
                />

                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-base font-semibold text-foreground">
                    {note.title}
                  </h2>
                  <span className="text-[11px] font-mono text-muted-foreground rounded border border-border px-1.5 py-0.5">
                    v{note.version}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatPatchDate(note.date)}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {note.summary}
                </p>

                <ul className="mt-4 space-y-2.5">
                  {note.changes.map((change, i) => {
                    const style = TYPE_STYLES[change.type];
                    const Icon = style.icon;
                    return (
                      <li
                        key={i}
                        className="rounded-lg border border-border bg-card p-3 flex gap-3 shadow-sm"
                      >
                        <div
                          className={cn(
                            "rounded-md p-1.5 shrink-0 h-fit",
                            style.iconWrap,
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={cn(
                                "text-[10px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5 border",
                                style.badge,
                              )}
                            >
                              {PATCH_CHANGE_LABELS[change.type]}
                            </span>
                            <span className="text-[13px] font-medium text-foreground">
                              {change.text}
                            </span>
                            {/* The full record lives here, so Admin-only
                                items are shown rather than hidden — just
                                marked, since the pop-up skipped them. */}
                            {change.audience === "admin" && (
                              <span className="text-[10px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5 border bg-muted text-muted-foreground border-border">
                                Admin
                              </span>
                            )}
                          </div>
                          {change.detail && (
                            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                              {change.detail}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

export default PatchNotesPage;
