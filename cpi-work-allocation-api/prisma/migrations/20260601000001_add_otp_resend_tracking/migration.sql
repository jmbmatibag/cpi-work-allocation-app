-- OTP-resend abuse tracking for POST /api/auth/resend-otp.
--   otpResendCount  — resends issued in the current window.
--   otpLockoutUntil — when set in the future, resends are refused (429)
--                     until this timestamp. Reset on successful login.
ALTER TABLE "User" ADD COLUMN "otpResendCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "otpLockoutUntil" TIMESTAMP(3);
