-- Remove the deprecated 'Head' value from the UserRole enum.
--
-- Postgres cannot DROP a value from an enum in place, so we recreate the
-- type. `roles` is a UserRole[] column, so we first strip any lingering
-- 'Head' membership before re-casting the column to the new enum.

-- 1. Defensively remove 'Head' from any existing roles arrays. (The seed
--    has no Head-role users, but production data is not assumed clean.)
--    Order within the array is not semantic, so rebuilding it is safe.
UPDATE "User"
  SET "roles" = ARRAY(
    SELECT r FROM unnest("roles") AS r WHERE r <> 'Head'::"UserRole"
  )::"UserRole"[];

-- 2. Any user left with no roles gets 'Employee' as a safe floor (a user
--    with zero roles can see nothing — a corrupt state, not a real one).
UPDATE "User"
  SET "roles" = ARRAY['Employee']::"UserRole"[]
  WHERE cardinality("roles") = 0;

-- 3. Recreate the enum without 'Head'.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('Employee', 'Manager', 'Finance', 'Admin');
ALTER TABLE "User"
  ALTER COLUMN "roles" TYPE "UserRole"[] USING ("roles"::text[]::"UserRole"[]);
DROP TYPE "UserRole_old";
