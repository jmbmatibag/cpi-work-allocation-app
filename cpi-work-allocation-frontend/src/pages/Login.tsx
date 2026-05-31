import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import FormError from "@/components/FormError";
import { toast } from "sonner";
import { Lock, Mail, ShieldCheck, ArrowLeft, Eye, EyeOff, KeyRound } from "lucide-react";
import { sendMockOtp, verifyOtp as verifyMockOtp } from "@/lib/mockEmailService";
import { api, ApiError } from "@/lib/apiClient";

// Seconds the user must wait between OTP resend requests.
const RESEND_COOLDOWN_SECONDS = 60;

// ── Two-step sign-in. One component for all modes ─────────────────────────────
//
// API mode  : step 1 = email + password  → POST /api/auth/login    (verifies pw, emails OTP)
//             step 2 = OTP code          → POST /api/auth/verify-otp
//             forgot  = email input      → POST /api/auth/forgot-password
//             forgotSent = confirmation screen (no further user input)
// Local mode: step 1 = email + password  (checked against EmployeesContext)
//             step 2 = 6-digit mock OTP  (generated in-browser)
//             (forgot-password not available in local mode)

type LoginStep = "credentials" | "otp" | "forgot" | "forgotSent";

const Login = () => {
  const { login, checkCredentials, loginWithPassword, verifyAndLogin, isApiMode } =
    useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [step, setStep] = useState<LoginStep>("credentials");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [credError, setCredError] = useState<string | null>(null);
  const [forgotEmail, setForgotEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Resend-OTP cooldown + state ───────────────────────────────────────────
  const [timeLeft, setTimeLeft] = useState(RESEND_COOLDOWN_SECONDS);
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState("");

  // Countdown ticker. Runs only on the OTP step and only while time
  // remains. Depending on [step, timeLeft] re-arms the interval each second;
  // the cleanup clears the previous one, so there's never more than one live
  // interval and none survives unmount or a step change (no memory leak, no
  // runaway loop). When a resend resets timeLeft back to 60, this re-fires
  // and the countdown restarts.
  useEffect(() => {
    if (step !== "otp" || timeLeft <= 0) return;
    const intervalId = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(intervalId);
  }, [step, timeLeft]);

  // Enter the OTP step with a fresh cooldown and cleared resend state.
  const goToOtpStep = () => {
    setTimeLeft(RESEND_COOLDOWN_SECONDS);
    setResendError("");
    setOtpError("");
    setStep("otp");
  };

  // ── Step 1: Credentials ───────────────────────────────────────────────────

  const handleCredentialsSubmit = async () => {
    if (!email || !password) {
      toast.error("Please enter both email and password.");
      return;
    }

    if (isApiMode) {
      setIsSubmitting(true);
      setCredError(null);
      try {
        await loginWithPassword(email, password);
        goToOtpStep();
        toast.info("OTP sent", {
          description: "Check your email inbox for your one-time password.",
        });
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? (err.body as { error?: string })?.error ?? "Invalid email or password."
            : "Could not sign in. Please try again.";
        setCredError(msg);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      if (!checkCredentials(email, password)) {
        toast.error("Invalid credentials", {
          description: "Please check your email and password.",
        });
        return;
      }
      sendMockOtp(email);
      goToOtpStep();
      toast.info("OTP sent", {
        description: "Check the browser console for your mock OTP.",
      });
    }
  };

  // ── Step 2: OTP verification ──────────────────────────────────────────────

  const handleOtpSubmit = async () => {
    if (!otp) {
      setOtpError("Please enter the OTP.");
      return;
    }

    setIsSubmitting(true);
    setOtpError("");

    if (isApiMode) {
      try {
        await verifyAndLogin(email, otp);
        toast.success("Welcome back!");
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? (err.body as { error?: string })?.error ?? "Invalid code."
            : "Invalid code.";
        setOtpError(msg);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      if (!verifyMockOtp(otp)) {
        setOtpError("Incorrect OTP. Please try again.");
        setIsSubmitting(false);
        return;
      }
      login(email, password);
      toast.success("Welcome back!");
      setIsSubmitting(false);
    }
  };

  // ── Resend OTP ────────────────────────────────────────────────────────────

  const handleResend = async () => {
    // Guard: ignore clicks while the cooldown is still running or a resend
    // is already in flight (the button is also disabled in both cases).
    if (timeLeft > 0 || isResending) return;

    setIsResending(true);
    setResendError("");
    setOtpError("");

    try {
      if (isApiMode) {
        await api.auth.resendOtp(email);
      } else {
        sendMockOtp(email);
      }
      setOtp("");
      setTimeLeft(RESEND_COOLDOWN_SECONDS); // restart the cooldown
      toast.info("Code resent", {
        description: "We've sent a new one-time code to your email.",
      });
    } catch (err) {
      // 429 (rate-limit / lockout) and any other failure surface as a
      // minimalist inline message — the OTP window stays open.
      const msg =
        err instanceof ApiError
          ? (err.body as { error?: string })?.error ??
            "Too many attempts. Please try again later."
          : "Couldn't resend the code. Please try again.";
      setResendError(msg);
    } finally {
      setIsResending(false);
    }
  };

  // ── Forgot password (API mode only) ──────────────────────────────────────

  const handleForgotSubmit = async () => {
    if (!forgotEmail) {
      toast.error("Please enter your email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.auth.forgotPassword(forgotEmail);
      setStep("forgotSent");
    } catch {
      // The endpoint always returns 200 so network errors are the only failure.
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    setStep("credentials");
    setOtp("");
    setOtpError("");
    setResendError("");
  };

  // ── Render ────────────────────────────────────────────────────────────────

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
            Work Allocation Portal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === "credentials" && "Sign in to your workspace"}
            {step === "otp" && "Enter your one-time password"}
            {step === "forgot" && "Reset your password"}
            {step === "forgotSent" && "Check your email"}
          </p>
        </div>

        <div className="glass-card rounded-2xl p-8 space-y-6">

          {/* ── Step: credentials ── */}
          {step === "credentials" && (
            <>
              <FormError message={credError} />

              <div className="space-y-2">
                <Label className="text-sm font-medium">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="you@cpi.com.ph"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setCredError(null); }}
                    onKeyDown={(e) =>
                      e.key === "Enter" && !isSubmitting && handleCredentialsSubmit()
                    }
                    className="pl-10"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setCredError(null); }}
                    onKeyDown={(e) =>
                      e.key === "Enter" && !isSubmitting && handleCredentialsSubmit()
                    }
                    className="pl-10 pr-10"
                    autoComplete="current-password"
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

              <Button
                className="w-full"
                onClick={handleCredentialsSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Signing in…" : "Continue"}
              </Button>

              {isApiMode && (
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(email);
                    setStep("forgot");
                  }}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Forgot password?
                </button>
              )}
            </>
          )}

          {/* ── Step: OTP ── */}
          {step === "otp" && (
            <>
              <FormError message={otpError} />

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  A one-time password has been sent to{" "}
                  <span className="font-medium text-foreground">{email}</span>.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">One-Time Password</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => {
                    const onlyNumbers = e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6);
                    setOtp(onlyNumbers);
                    setOtpError("");
                  }}
                  onKeyDown={(e) =>
                    e.key === "Enter" && !isSubmitting && handleOtpSubmit()
                  }
                  maxLength={6}
                  className="text-center tracking-widest text-lg"
                />
              </div>

              <Button
                className="w-full"
                onClick={handleOtpSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Verifying…" : "Verify & Sign In"}
              </Button>

              {/* Resend code — disabled until the cooldown elapses */}
              <div className="text-center space-y-1">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={timeLeft > 0 || isResending}
                  className="text-sm font-medium text-primary hover:text-primary/80 transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                >
                  {isResending
                    ? "Sending…"
                    : timeLeft > 0
                      ? `Resend code in 0:${String(timeLeft).padStart(2, "0")}`
                      : "Resend Code"}
                </button>
                {resendError && (
                  <p className="text-xs text-destructive">{resendError}</p>
                )}
              </div>

              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </button>
            </>
          )}

          {/* ── Step: forgot password ── */}
          {step === "forgot" && (
            <>
              <p className="text-sm text-muted-foreground">
                Enter your registered email address and we'll send you a secure
                link to reset your password.
              </p>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="you@cpi.com.ph"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && !isSubmitting && handleForgotSubmit()
                    }
                    className="pl-10"
                    autoComplete="email"
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={handleForgotSubmit}
                disabled={isSubmitting || !forgotEmail}
              >
                {isSubmitting ? "Sending…" : "Send reset link"}
              </Button>

              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </button>
            </>
          )}

          {/* ── Step: forgot sent confirmation ── */}
          {step === "forgotSent" && (
            <>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  If <span className="font-medium text-foreground">{forgotEmail}</span> is
                  registered, you'll receive a reset link shortly. The link
                  expires in 1 hour.
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleBack}
              >
                Back to sign in
              </Button>
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default Login;
