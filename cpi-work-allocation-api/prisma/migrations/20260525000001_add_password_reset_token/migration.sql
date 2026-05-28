-- AlterTable: add forgot-password reset token + expiry to User
ALTER TABLE "User" ADD COLUMN "passwordResetToken"     TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

-- CreateIndex: unique lookup for reset token (same pattern as setup token)
CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");
