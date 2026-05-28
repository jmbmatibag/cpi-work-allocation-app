-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_employeeId_fkey";

-- AlterTable
ALTER TABLE "OtpCode" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AllocationActivity_recordId_idx" ON "AllocationActivity"("recordId");

-- CreateIndex
CREATE INDEX "AllocationRecord_managerId_idx" ON "AllocationRecord"("managerId");

-- CreateIndex
CREATE INDEX "AllocationRecord_status_idx" ON "AllocationRecord"("status");

-- CreateIndex
CREATE INDEX "AllocationRecord_year_monthIndex_idx" ON "AllocationRecord"("year", "monthIndex");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "JournalEntry_employeeId_date_idx" ON "JournalEntry"("employeeId", "date");

-- CreateIndex
CREATE INDEX "OtpCode_userId_used_expiresAt_idx" ON "OtpCode"("userId", "used", "expiresAt");

-- CreateIndex
CREATE INDEX "SubCategory_mainCategoryId_idx" ON "SubCategory"("mainCategoryId");

-- CreateIndex
CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
