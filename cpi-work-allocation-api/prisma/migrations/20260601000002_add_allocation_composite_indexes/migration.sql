-- Migration: add two composite indexes on AllocationRecord for the most common
-- query patterns in list() — employee/manager scoped list ordered by period,
-- and admin/finance status-filtered list ordered by period.
-- IF NOT EXISTS makes this safe to re-run on a database that already has the indexes.

CREATE INDEX IF NOT EXISTS "AllocationRecord_employeeId_year_monthIndex_idx"
    ON "AllocationRecord"("employeeId", "year", "monthIndex");

CREATE INDEX IF NOT EXISTS "AllocationRecord_status_year_monthIndex_idx"
    ON "AllocationRecord"("status", "year", "monthIndex");
