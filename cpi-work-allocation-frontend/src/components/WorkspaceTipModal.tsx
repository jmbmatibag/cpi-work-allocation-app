import { useState } from "react";
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

export interface TipSection {
  heading: string;
  body: string;
}

interface WorkspaceTipModalProps {
  /** localStorage key used to persist "do not show again" */
  storageKey: string;
  title: string;
  subtitle?: string;
  tips: TipSection[];
  /** Small muted note rendered below the tip cards */
  note?: string;
  /** When true, shows the modal regardless of the localStorage flag */
  forceOpen?: boolean;
  /** Called when the modal is closed while forceOpen is true */
  onClose?: () => void;
}

/**
 * One-time onboarding overlay for a workspace page.
 *
 * Reads `localStorage.getItem(storageKey)` on mount; if truthy the modal
 * never renders. When the user checks "Do not show again" and clicks
 * "Got it", the key is written so subsequent visits skip it.
 */
export default function WorkspaceTipModal({
  storageKey,
  title,
  subtitle,
  tips,
  note,
  forceOpen,
  onClose,
}: WorkspaceTipModalProps) {
  const [dismissed, setDismissed] = useState<boolean>(
    () => !!localStorage.getItem(storageKey),
  );
  const [doNotShow, setDoNotShow] = useState(false);

  const isVisible = forceOpen === true || !dismissed;
  if (!isVisible) return null;

  const handleClose = () => {
    if (forceOpen) {
      onClose?.();
      return;
    }
    if (doNotShow) localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  return (
    <Dialog open onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-xl overflow-hidden">
        {/* Accent bar — overflow-hidden on DialogContent clips it to the modal's rounded corners */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{ background: "linear-gradient(90deg, hsl(224 72% 45%), hsl(262 60% 55%))" }}
        />

        <DialogHeader className="pt-2">
          <DialogTitle className="text-xl font-semibold" style={{ color: "hsl(222 20% 12%)" }}>
            {title}
          </DialogTitle>
          {subtitle && (
            <DialogDescription className="text-sm mt-1" style={{ color: "hsl(220 10% 45%)" }}>
              {subtitle}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Tip cards */}
        <div className="space-y-3 py-1">
          {tips.map((tip, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-lg p-3"
              style={{ background: "hsl(220 14% 97%)", border: "1px solid hsl(220 13% 92%)" }}
            >
              {/* Step badge */}
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-[11px] font-bold"
                style={{ background: "hsl(224 72% 45%)", color: "hsl(0 0% 100%)" }}
              >
                {i + 1}
              </div>
              <div className="space-y-0.5 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: "hsl(222 20% 15%)" }}>
                  {tip.heading}
                </p>
                <p className="text-[12.5px] leading-relaxed" style={{ color: "hsl(220 10% 40%)" }}>
                  {tip.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        {note && (
          <p className="text-[11.5px] leading-relaxed px-0.5" style={{ color: "hsl(220 10% 50%)" }}>
            <span className="font-medium">Note:</span> {note}
          </p>
        )}

        <DialogFooter className="flex items-center gap-3 pt-2 sm:justify-between">
          {/* "Do not show again" checkbox — hidden when opened manually via the Guide button */}
          <div className="flex items-center gap-2">
            {!forceOpen && (
              <>
                <Checkbox
                  id={`${storageKey}-hide`}
                  checked={doNotShow}
                  onCheckedChange={(v) => setDoNotShow(!!v)}
                />
                <Label
                  htmlFor={`${storageKey}-hide`}
                  className="text-[12px] cursor-pointer select-none"
                  style={{ color: "hsl(220 10% 45%)" }}
                >
                  Do not show again
                </Label>
              </>
            )}
          </div>

          <Button
            onClick={handleClose}
            size="sm"
            className="px-5"
            style={{ background: "hsl(224 72% 45%)", color: "white" }}
          >
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
