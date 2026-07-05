-- AlterTable
-- Adds the notification-exemption flag to User. Default false so every
-- existing row keeps receiving scheduled reminder emails; admins opt
-- individuals out from the Employee Management view. Consumed by the
-- reminder scheduler (src/lib/reminderScheduler.ts).
ALTER TABLE "User" ADD COLUMN "emailNotificationsExempt" BOOLEAN NOT NULL DEFAULT false;
