import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const SESSION_EXPIRED_EVENT = "auth:session-expired";

export default function SessionExpiredModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handle = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, handle);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handle);
  }, []);

  const goToLogin = () => {
    window.location.href = "/login";
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-xs [&>button:last-child]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <ShieldAlert className="h-7 w-7 text-destructive" />
          </div>

          <DialogHeader className="space-y-1">
            <DialogTitle className="text-base font-semibold">
              Session Expired
            </DialogTitle>
            <DialogDescription className="text-sm">
              Your session has ended. Please sign in again to continue.
            </DialogDescription>
          </DialogHeader>

          <Button onClick={goToLogin} className="w-full">
            Sign In Again
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
