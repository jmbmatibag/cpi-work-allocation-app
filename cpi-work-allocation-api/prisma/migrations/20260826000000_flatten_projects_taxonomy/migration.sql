-- Flatten Projects taxonomy — STRUCTURE ONLY.
--
-- Additive and backward-compatible by design: every new column is nullable
-- or defaulted, so this can be deployed AHEAD of the data migration
-- (scripts/flatten-projects.ts) with the current app still running against
-- it. There is no window in which the deployed code is broken.
--
-- The data move is deliberately NOT here. Prisma migrations run
-- automatically on deploy; a 1,000-row re-streaming of live allocation
-- records must be run deliberately, with a dry run first.

-- Client roster for sub-less main categories (promoted projects).
ALTER TABLE "MainCategory"
  ADD COLUMN "clients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- One-hop cascade anchor for rules on a main category with no sub tier.
ALTER TABLE "InferenceRule"
  ADD COLUMN "mainCategoryId" INTEGER;

CREATE INDEX "InferenceRule_mainCategoryId_idx"
  ON "InferenceRule"("mainCategoryId");

ALTER TABLE "InferenceRule"
  ADD CONSTRAINT "InferenceRule_mainCategoryId_fkey"
  FOREIGN KEY ("mainCategoryId") REFERENCES "MainCategory"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
