-- Structured Enhancement tag for "Specific Enhancement" activities.
--
-- Purely additive: nullable, no default, no backfill. Existing rows stay NULL
-- and the Finance export recovers their tag by parsing `description` at export
-- time (see lib/financeExport.ts -> resolveEnhancement).
ALTER TABLE "AllocationActivity" ADD COLUMN "enhancementTag" TEXT;
