import { useMemo, useState } from "react";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormError from "@/components/FormError";
import { api, ApiError } from "@/lib/apiClient";
import PasswordStrengthMeter, { evaluateStrength } from "@/components/PasswordStrengthMeter";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ChangePasswordDialog = ({ open, onOpenChange }: ChangePasswordDialogProps) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword]         = useState("");
  const [confirm, setConfirm]                 = useState("");
  const [showCurrent, setShowCurrent]         = useState(false);
  const [showNew, setShowNew]                 = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [serverError, setServerError]         = useState<string | null>(null);

  const strength       = useMemo(() => evaluateStrength(newPassword), [newPassword]);
  const passwordsMatch = confirm.length > 0 && newPassword === confirm;
  const canSubmit      = !!currentPassword && strength.allValid && passwordsMatch && !submitting;

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setShowCurrent(false);
    setShowNew(false);
    setServerError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setServerError(null);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      // Backend always returns sessionExpired:true — it forces a full
      // logout so the new password takes effect on the very next sign-in.
      toast.success("Password changed", {
        description: "Your password has been updated. Please sign in again.",
      });
      localStorage.clear();
      window.location.href = '/login';
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (err.body as { error?: string })?.error ?? "Could not change your password."
          : "Could not change your password.";
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>
            Enter your current password and choose a strong new one.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-5 py-2">
          {/* Form-level error — sits at the top, above the first input */}
          <FormError message={serverError} />

          {/* Current password */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Current Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showCurrent ? "text" : "password"}
                placeholder="••••••••"
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setServerError(null); }}
                className="pl-10 pr-10"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">New Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showNew ? "text" : "password"}
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pl-10 pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <PasswordStrengthMeter password={newPassword} />

          {/* Confirm new password */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Confirm New Password</Label>
            <div className="relative">
              <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showNew ? "text" : "password"}
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="pl-10"
                autoComplete="new-password"
              />
            </div>
            {confirm.length > 0 && !passwordsMatch && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;
