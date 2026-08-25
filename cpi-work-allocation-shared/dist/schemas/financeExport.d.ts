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
export declare const FinanceExportQuerySchema: z.ZodObject<{
    month: z.ZodOptional<z.ZodString>;
    year: z.ZodOptional<z.ZodString>;
    team: z.ZodOptional<z.ZodString>;
    employeeId: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        Draft: "Draft";
        PendingReview: "PendingReview";
        Approved: "Approved";
        NeedsRevision: "NeedsRevision";
        all: "all";
    }>>>;
    format: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        csv: "csv";
        json: "json";
    }>>>;
}, z.core.$strip>;
export type FinanceExportQuery = z.infer<typeof FinanceExportQuerySchema>;
//# sourceMappingURL=financeExport.d.ts.map