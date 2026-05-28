-- Two-step (password + OTP) authentication upgrade.
--
--   1. `passwordHash` becomes nullable. Admin-created accounts no longer
--      get a placeholder hash — they are issued a one-time setup token
--      and remain "not set up" until the user completes
--      POST /api/auth/setup-password.
--   2. `passwordSetupToken` (unique) + `passwordSetupExpiresAt` store the
--      single-use credential mailed to the user via the welcome email.
--      24-hour TTL is enforced in the controller; cleared on redemption.

ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN "passwordSetupToken" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordSetupExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_passwordSetupToken_key" ON "User"("passwordSetupToken");
