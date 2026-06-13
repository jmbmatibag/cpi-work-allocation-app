import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

/**
 * UnsavedChangesContext — a router-agnostic navigation guard with a styled
 * confirmation dialog (not the native window.confirm).
 *
 * Why not React Router's `useBlocker` / `<Prompt>`? Those only work inside a
 * *data router* (`createBrowserRouter`). This app uses `<BrowserRouter>` +
 * `<Routes>`, where those hooks throw. So instead of blocking at the router
 * level, navigation surfaces (the sidebar) route their intent through
 * `guard(proceed)`: if there are no unsaved changes the action runs
 * immediately; if there are, we open an AlertDialog and only run `proceed`
 * once the user confirms.
 *
 * The dirty flag lives in a ref (not state) so registering it on every
 * keystroke doesn't re-render the whole authed shell — it's only ever read
 * synchronously at the moment a navigation is attempted.
 *
 * Note: the browser tab-close / refresh case is handled separately by a
 * native `beforeunload` listener (see DailyJournal). Browsers do not allow a
 * custom dialog there — that prompt is owned by the browser by design.
 */

const DEFAULT_MESSAGE =
  "You have unsaved changes on this page. If you leave now, they won't be saved.";

interface GuardState {
  isDirty: boolean;
  message: string;
}

interface UnsavedChangesContextValue {
  /** Register (or clear) the current page's unsaved-changes state. */
  setGuard: (isDirty: boolean, message?: string) => void;
  /** Synchronously read whether navigation is currently blocked. */
  isBlocked: () => boolean;
  /**
   * Run `proceed` if it's safe to navigate. If there are unsaved changes,
   * defer it behind a confirmation dialog and only run it on confirm.
   */
  guard: (proceed: () => void) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue>({
  setGuard: () => {},
  isBlocked: () => false,
  guard: (proceed) => proceed(),
});

export const useUnsavedChangesGuard = () => useContext(UnsavedChangesContext);

export const UnsavedChangesProvider = ({ children }: { children: ReactNode }) => {
  const guardRef = useRef<GuardState>({ isDirty: false, message: DEFAULT_MESSAGE });
  // The action awaiting confirmation. Non-null = dialog open.
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  const setGuard = useCallback((isDirty: boolean, msg?: string) => {
    guardRef.current = { isDirty, message: msg ?? DEFAULT_MESSAGE };
  }, []);

  const isBlocked = useCallback(() => guardRef.current.isDirty, []);

  const guard = useCallback((proceed: () => void) => {
    if (!guardRef.current.isDirty) {
      proceed();
      return;
    }
    setMessage(guardRef.current.message);
    // Stash the callback (wrapped so React's state-updater form stores the
    // function itself rather than invoking it).
    setPending(() => proceed);
  }, []);

  const handleLeave = useCallback(() => {
    const proceed = pending;
    setPending(null);
    proceed?.();
  }, [pending]);

  const handleStay = useCallback(() => setPending(null), []);

  return (
    <UnsavedChangesContext.Provider value={{ setGuard, isBlocked, guard }}>
      {children}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-warning/10 text-warning shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <AlertDialogTitle className="text-lg">
                Leave without saving?
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="pt-1 leading-relaxed">
              {message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleStay}>
              Stay on this page
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave without saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UnsavedChangesContext.Provider>
  );
};
