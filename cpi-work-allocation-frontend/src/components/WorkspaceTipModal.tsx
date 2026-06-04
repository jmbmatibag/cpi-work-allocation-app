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
        {/* Accent bar */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(262 60% 55%))" }}
        />

        <DialogHeader className="pt-2">
          <DialogTitle className="text-xl font-semibold text-foreground">
            {title}
          </DialogTitle>
          {subtitle && (
            <DialogDescription className="text-sm mt-1 text-muted-foreground">
              {subtitle}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Tip cards */}
        <div className="space-y-3 py-1">
          {tips.map((tip, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-lg p-3 bg-muted/60 border border-border"
            >
              {/* Step badge */}
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-[11px] font-bold bg-primary text-primary-foreground"
              >
                {i + 1}
              </div>
              <div className="space-y-0.5 min-w-0">
                <p className="text-[13px] font-semibold text-foreground">
                  {tip.heading}
                </p>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  {tip.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        {note && (
          <p className="text-[11.5px] leading-relaxed px-0.5 text-muted-foreground">
            <span className="font-medium">Note:</span> {note}
          </p>
        )}

        <DialogFooter className="flex items-center gap-3 pt-2 sm:justify-between">
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
                  className="text-[12px] cursor-pointer select-none text-muted-foreground"
                >
                  Do not show again
                </Label>
              </>
            )}
          </div>

          <Button onClick={handleClose} size="sm" className="px-5">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
