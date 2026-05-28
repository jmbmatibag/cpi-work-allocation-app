-- Multi-role users: replace single `role` with array `roles`.
--
-- Done in four steps so existing data is preserved:
--   1. Add `roles` column with a temporary default of empty array.
--   2. Backfill from the existing `role` column (each user's single
--      role becomes a one-element array).
--   3. Drop the temporary default and the now-obsolete `@@index([role])`.
--   4. Drop the `role` column.
--
-- Reversible up to step 4 — after the column is dropped, the original
-- "primary role" can no longer be recovered without inspecting the
-- migration itself.

-- 1. Add the new array column.
ALTER TABLE "User"
  ADD COLUMN "roles" "UserRole"[] NOT NULL DEFAULT ARRAY[]::"UserRole"[];

-- 2. Backfill: wrap each existing role in a single-element array.
UPDATE "User" SET "roles" = ARRAY["role"]::"UserRole"[];

-- 3. Drop the temporary default — going forward every insert MUST set
--    roles explicitly. Also drop the obsolete single-role index.
ALTER TABLE "User" ALTER COLUMN "roles" DROP DEFAULT;
DROP INDEX IF EXISTS "User_role_idx";

-- 4. Drop the legacy single-role column.
ALTER TABLE "User" DROP COLUMN "role";
