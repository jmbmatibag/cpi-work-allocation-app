import { z } from 'zod';

/**
 * Finance export query.
 *
 * Finance reports on signed-off work, so `status` narrows to Approved by
 * default — a report that silently mixes in Drafts is worse than one that
 * returns nothing. Pass `status=all` to widen deliberately.
 *
 * `month`/`year` are optional: omitted, the controller falls back to
 * getReportingPeriod() (the previous calendar month), matching the global
 * arrears rule every other reporting view already follows.
 */
export const FinanceExportQuerySchema = z.object({
  month: z.string().min(1).optional(),
  year: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  status: z
    .enum(['Approved', 'PendingReview', 'Draft', 'NeedsRevision', 'all'])
    .optional()
    .default('Approved'),
  format: z.enum(['csv', 'json']).optional().default('csv'),
});

export type FinanceExportQuery = z.infer<typeof FinanceExportQuerySchema>;
