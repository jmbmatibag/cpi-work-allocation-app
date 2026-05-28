import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Lock, ShieldCheck, X, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/apiClient";
import PasswordStrengthMeter, { evaluateStrength } from "@/components/PasswordStrengthMeter";

const ResetPassword = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const strength = useMemo(() => evaluateStrength(password), [password]);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = strength.allValid && passwordsMatch && !!token && !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setServerError(null);
    try {
      await api.auth.resetPassword(token, password);
      toast.success("Password reset", {
        description: "Sign in below with your new password.",
      });
      setTimeout(() => navigate("/login", { replace: true }), 400);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (err.body as { error?: string })?.error ?? "Could not reset your password."
          : "Could not reset your password.";
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="relative w-full max-w-md mx-4 text-center">
          <div className="glass-card rounded-2xl p-8 space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600 mx-auto">
              <X className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-semibold">Reset link missing</h1>
            <p className="text-sm text-muted-foreground">
              This page can only be opened from the secure link in your
              password-reset email. If the link has expired, request a new one
              from the sign-in page.
            </p>
            <Button variant="outline" onClick={() => navigate("/login")}>
              Go to sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-primary/5 via-primary/3 to-transparent blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-gradient-to-br from-accent/5 to-transparent blur-3xl" />
      </div>

      <div className="relative w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden">
            <img
              src="/cpi-logo.png"
              alt="CPI Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Reset your password
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a strong new password for your account.
          </p>
        </div>

        <form className="glass-card rounded-2xl p-8 space-y-6" onSubmit={onSubmit} noValidate>
          {/* New password */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">New password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <PasswordStrengthMeter password={password} />

          {/* Confirm password */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Confirm password</Label>
            <div className="relative">
              <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showPw ? "text" : "password"}
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

          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {submitting ? "Saving…" : "Set new password"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
