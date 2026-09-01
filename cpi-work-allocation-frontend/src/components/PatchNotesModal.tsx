import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { primaryRole } from "cpi-work-allocation-shared";
import { useAuth } from "@/contexts/AuthContext";
import { roleHomePath } from "@/routes/routeConfig";
import { Sparkles, Wrench, Bug, ArrowRightLeft, PartyPopper } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  LATEST_PATCH_NOTE,
  PATCH_NOTES_SEEN_KEY,
  PATCH_CHANGE_LABELS,
  shouldShowPatchNotes,
  userFacingChanges,
  formatPatchDate,
  type PatchChangeType,
} from "@/lib/patchNotes";

/**
 * "Patch Update!" pop-up announcing the latest release.
 *
 * Trigger is purely client-side: the latest note's `version` compared against
 * the version stored in localStorage. Deploying a new bundle with a bumped
 * version is therefore the entire release mechanism — no server flag to set
 * and no risk of the flag and the deployed code disagreeing.
 *
 * Two deliberate constraints:
 *
 *  • It only opens on the user's LANDING screen — so the note arrives as
 *    someone starts their session rather than interrupting them mid-edit on
 *    the Journal or an allocation card. That screen is role-dependent
 *    (roleHomePath): /dashboard for Employee/Manager/Finance, /employees for
 *    Admin, who cannot reach /dashboard at all. Hardcoding /dashboard would
 *    silently exclude every Admin.
 *
 *  • Dismissal follows WorkspaceTipModal: closing hides it, and only the
 *    "Do not show again" checkbox persists that choice. Persisting the
 *    VERSION (not a boolean) means dismissing v1.4.0 never suppresses v1.5.0.
 *
 *  • It opens at most ONCE PER BROWSER SESSION. Re-popping on every reload
 *    would train people to click through without reading, which is exactly
 *    the failure this feature exists to avoid. Someone who never ticks the
 *    box still gets another look in their next session.
 *
 * Mounted once in AuthenticatedLayout rather than inside the dashboard page,
 * so navigating away and back does not remount it and re-open the pop-up.
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

/**
 * Marks that this release has already popped in the current browser session.
 *
 * sessionStorage, not localStorage: this means "seen it a moment ago", which
 * should lapse when the browser session does. The permanent choice lives in
 * localStorage under PATCH_NOTES_SEEN_KEY and is written only by the
 * checkbox. Kept here rather than in lib/patchNotes.ts because it is a
 * presentation concern — the lib owns the releases and the persisted
 * decision; this component owns "have I already popped".
 */
const SESSION_SHOWN_KEY = "cpi.patchNotesShownThisSession";

/** Storage access that never throws (private mode, blocked cookies, ...). */
function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    // Non-fatal — the in-memory ref still prevents a re-open this mount.
  }
}

export default function PatchNotesModal() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [doNotShow, setDoNotShow] = useState(false);
  // Belt-and-braces for when sessionStorage is unavailable: without it the
  // effect would re-open every time the user navigated back to their landing
  // screen after closing.
  const openedThisSession = useRef(false);

  useEffect(() => {
    if (openedThisSession.current) return;
    if (!currentUser) return;
    // Same mapping RoleHomeRedirect uses to resolve "/".
    if (pathname !== roleHomePath[primaryRole(currentUser.roles)]) return;
    // Permanently dismissed via the checkbox?
    if (!shouldShowPatchNotes(safeGet(localStorage, PATCH_NOTES_SEEN_KEY))) return;
    // Already popped earlier in this browser session?
    if (safeGet(sessionStorage, SESSION_SHOWN_KEY) === LATEST_PATCH_NOTE.version) return;

    safeSet(sessionStorage, SESSION_SHOWN_KEY, LATEST_PATCH_NOTE.version);
    openedThisSession.current = true;
    setOpen(true);
  }, [pathname, currentUser]);

  if (!LATEST_PATCH_NOTE || !open) return null;

  const close = () => {
    // Only the checkbox writes the permanent record; a plain close lets the
    // note return in the user's next session.
    if (doNotShow) {
      safeSet(localStorage, PATCH_NOTES_SEEN_KEY, LATEST_PATCH_NOTE.version);
    }
    setOpen(false);
  };

  return (
    <Dialog open onOpenChange={() => close()}>
      {/* Flex column so the header/footer stay put and only the change list
          scrolls — same structure as WorkspaceTipModal. */}
      <DialogContent className="max-w-xl !flex !flex-col gap-0 !p-0 overflow-hidden">
        <div
          className="h-1.5 shrink-0"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--primary)), hsl(262 60% 55%))",
          }}
        />

        <div className="scrollbar-modern flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-3">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-primary/10 text-primary p-2 shrink-0">
                <PartyPopper className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-xl font-semibold text-foreground">
                  Patch Update!
                </DialogTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Version {LATEST_PATCH_NOTE.version} &middot;{" "}
                  {formatPatchDate(LATEST_PATCH_NOTE.date)}
                </p>
              </div>
            </div>
            <DialogDescription className="text-sm mt-3 text-muted-foreground">
              {LATEST_PATCH_NOTE.summary}
            </DialogDescription>
          </DialogHeader>

          <p className="mt-5 mb-3 text-sm font-semibold text-foreground">
            What&apos;s New:
          </p>

          <ul className="space-y-2.5">
            {/* Admin-only items are filtered out here — see PatchChange.audience.
                They remain on /whats-new, which the footer links to. */}
            {userFacingChanges(LATEST_PATCH_NOTE).map((change, i) => {
              const style = TYPE_STYLES[change.type];
              const Icon = style.icon;
              return (
                <li
                  key={i}
                  className="rounded-lg border border-border bg-muted/20 p-3 flex gap-3"
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
        </div>

        {/* Pinned footer — always visible */}
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3 sm:justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="patch-notes-hide"
              checked={doNotShow}
              onCheckedChange={(v) => setDoNotShow(!!v)}
            />
            <Label
              htmlFor="patch-notes-hide"
              className="text-[12px] cursor-pointer select-none text-muted-foreground"
            >
              Do not show again
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                close();
                navigate("/whats-new");
              }}
            >
              View all updates
            </Button>
            <Button
              onClick={close}
              size="sm"
              className="px-5"
              style={{ background: "hsl(var(--primary))", color: "white" }}
            >
              Got it
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
