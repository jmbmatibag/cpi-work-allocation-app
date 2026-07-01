-- migrate-ghost-category.sql
-- Repoint the legacy category name "BD/Mktg/Sales" -> "Sales, Marketing & BD".
-- Exact-string match only. Does NOT touch the Team of the same name.
-- Validated against the live Prisma schema (PascalCase quoted identifiers).
--
-- Run inside the prod Postgres container, e.g.:
--   docker exec -it <pg_container> psql -U cpi -d cpi_work_allocation -f /path/to/this.sql
-- or paste into psql. Review the STEP 1 counts before allowing COMMIT.

\echo '=== STEP 1: BEFORE (read-only counts) ==='
SELECT
  (SELECT count(*) FROM "AllocationActivity" WHERE "streamCategory" = 'BD/Mktg/Sales') AS allocation_activities,
  (SELECT count(*) FROM "InferenceRule"      WHERE "category"       = 'BD/Mktg/Sales') AS inference_rules,
  (SELECT count(*) FROM "MainCategory"       WHERE "name"           = 'BD/Mktg/Sales') AS main_category,
  (SELECT count(*) FROM "WorkType"           WHERE 'BD/Mktg/Sales' = ANY("parents"))   AS work_type_parents,
  (SELECT count(*) FROM "JournalEntry"       WHERE "content" LIKE '%BD/Mktg/Sales%')    AS journal_entries;

BEGIN;

-- 1. MainCategory row — rename only if OLD still exists and NEW doesn't
--    (guards the unique-name index against a clash).
UPDATE "MainCategory"
   SET "name" = 'Sales, Marketing & BD'
 WHERE "name" = 'BD/Mktg/Sales'
   AND NOT EXISTS (SELECT 1 FROM "MainCategory" WHERE "name" = 'Sales, Marketing & BD');

-- 2. Allocation cards — the denormalised category copy (the visible ghost).
UPDATE "AllocationActivity"
   SET "streamCategory" = 'Sales, Marketing & BD'
 WHERE "streamCategory" = 'BD/Mktg/Sales';

-- 3. Inference rules — the live source of new mis-classifications.
UPDATE "InferenceRule"
   SET "category" = 'Sales, Marketing & BD'
 WHERE "category" = 'BD/Mktg/Sales';

-- 4. WorkType.parents[] — replace the array element.
--    NOTE: if a work type somehow already lists BOTH names (partial prior
--    rename), this leaves a duplicate entry; run the de-dup query at the
--    bottom if STEP 5 shows work_type_parents did not reach 0.
UPDATE "WorkType"
   SET "parents" = array_replace("parents", 'BD/Mktg/Sales', 'Sales, Marketing & BD')
 WHERE 'BD/Mktg/Sales' = ANY("parents");

-- 5. Journal raw text — literal occurrences a user typed.
UPDATE "JournalEntry"
   SET "content" = replace("content", 'BD/Mktg/Sales', 'Sales, Marketing & BD')
 WHERE "content" LIKE '%BD/Mktg/Sales%';

\echo '=== STEP 5: AFTER (should all be 0) — verify BEFORE committing ==='
SELECT
  (SELECT count(*) FROM "AllocationActivity" WHERE "streamCategory" = 'BD/Mktg/Sales') AS allocation_activities,
  (SELECT count(*) FROM "InferenceRule"      WHERE "category"       = 'BD/Mktg/Sales') AS inference_rules,
  (SELECT count(*) FROM "MainCategory"       WHERE "name"           = 'BD/Mktg/Sales') AS main_category,
  (SELECT count(*) FROM "WorkType"           WHERE 'BD/Mktg/Sales' = ANY("parents"))   AS work_type_parents,
  (SELECT count(*) FROM "JournalEntry"       WHERE "content" LIKE '%BD/Mktg/Sales%')    AS journal_entries;

-- If the AFTER counts look right, keep this COMMIT. If anything looks wrong,
-- replace it with ROLLBACK; and nothing changes.
COMMIT;

-- Optional de-dup (only if a WorkType ended up with the new name twice):
-- UPDATE "WorkType" w SET "parents" = sub.deduped
-- FROM (
--   SELECT id, array_agg(DISTINCT elem) AS deduped
--   FROM "WorkType", unnest("parents") AS elem GROUP BY id
-- ) sub
-- WHERE w.id = sub.id AND array_length(w."parents",1) <> array_length(sub.deduped,1);
