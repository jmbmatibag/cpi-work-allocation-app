-- Peer Coverage + action-tracking accountability.
--
-- 1. AllocationRecord gains actionedBy* columns: who ACTUALLY approved /
--    returned a record (may be a covering peer, not the assigned manager).
-- 2. New PeerCoverageTab table persists the peer-manager tabs a manager has
--    pinned onto Team Hub so they survive across sessions/devices.

-- AlterTable: action-tracking accountability on AllocationRecord.
ALTER TABLE "AllocationRecord" ADD COLUMN "actionedById" TEXT;
ALTER TABLE "AllocationRecord" ADD COLUMN "actionedByName" TEXT;
ALTER TABLE "AllocationRecord" ADD COLUMN "actionedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AllocationRecord_actionedById_idx" ON "AllocationRecord"("actionedById");

-- AddForeignKey: SetNull so approving/returning history survives actor deletion.
ALTER TABLE "AllocationRecord" ADD CONSTRAINT "AllocationRecord_actionedById_fkey" FOREIGN KEY ("actionedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: persisted peer-coverage tabs.
CREATE TABLE "PeerCoverageTab" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "peerManagerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeerCoverageTab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeerCoverageTab_managerId_peerManagerId_key" ON "PeerCoverageTab"("managerId", "peerManagerId");

-- CreateIndex
CREATE INDEX "PeerCoverageTab_managerId_idx" ON "PeerCoverageTab"("managerId");

-- AddForeignKey
ALTER TABLE "PeerCoverageTab" ADD CONSTRAINT "PeerCoverageTab_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerCoverageTab" ADD CONSTRAINT "PeerCoverageTab_peerManagerId_fkey" FOREIGN KEY ("peerManagerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
