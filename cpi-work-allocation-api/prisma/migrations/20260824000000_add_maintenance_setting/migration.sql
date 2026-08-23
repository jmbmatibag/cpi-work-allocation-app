-- CreateTable
-- Singleton maintenance-mode switch (always exactly one row, id = 1).
-- Read by the PUBLIC GET /api/maintenance, written only by Admins.
CREATE TABLE "MaintenanceSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT 'Scheduled Maintenance',
    "message" TEXT NOT NULL DEFAULT 'The CPI Work Allocation app is temporarily unavailable while we perform scheduled maintenance. Please check back shortly.',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceSetting_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row (maintenance OFF) so every read is a hit and the
-- app never has to create-on-first-GET. ON CONFLICT keeps this re-runnable.
INSERT INTO "MaintenanceSetting" ("id", "updatedAt")
VALUES (1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
