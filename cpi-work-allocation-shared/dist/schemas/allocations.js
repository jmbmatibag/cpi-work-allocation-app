import { z } from 'zod';
/**
 * Activity = one row inside a workstream (e.g. "Security work for AUII").
 * Exported so the frontend can z.infer<typeof ActivityDataSchema> and
 * stop maintaining a duplicate ActivityData interface.
 */
export const ActivityDataSchema = z.object({
    id: z.string(),
    team: z.string(),
    workCategory: z.string(),
    subCategory: z.string().nullable().optional(),
    workType: z.string(),
    client: z.string(),
    description: z.string(),
    percentage: z.number().min(0).max(100),
    expanded: z.boolean().optional().default(true),
});
/**
 * Workstream = grouped activities under a category (IT, Projects, etc.).
 * Exported alongside ActivityDataSchema for the same reason.
 */
export const WorkStreamDataSchema = z.object({
    category: z.string().min(1),
    activities: z.array(ActivityDataSchema),
    expanded: z.boolean().optional().default(true),
});
export const UpsertDraftSchema = z.object({
    // id is intentionally NOT accepted from clients — always derived server-side
    // on create to prevent primary-key spoofing.
    employeeId: z.string(),
    team: z.string(),
    managerId: z.string().nullable().optional(),
    month: z.string(),
    year: z.string(),
    monthIndex: z.number().int().min(0).max(11),
    streams: z.array(WorkStreamDataSchema),
});
export const ReturnForRevisionSchema = z.object({
    feedback: z.string().optional(),
});
// Optional streams on submit so the client can commit the final card
// state in the same transaction as the Draft→PendingReview status flip.
// Prevents the "submit succeeds, status flips, but the last unsaved
// activity edits never landed" race between autosave and submit.
// The whole body is optional — `.default({})` lets clients POST with no
// body at all (Express 5 leaves req.body undefined in that case).
export const SubmitAllocationSchema = z
    .object({
    streams: z.array(WorkStreamDataSchema).optional(),
})
    .default({});
export const FlagActivitySchema = z.object({
    reason: z.string().min(1),
});
export const AllocationStatusSchema = z.enum([
    'Draft',
    'PendingReview',
    'Approved',
    'NeedsRevision',
]);
export const ListAllocationsQuerySchema = z.object({
    employeeId: z.string().min(1).optional(),
    managerId: z.string().min(1).optional(),
    month: z.string().min(1).optional(),
    year: z.string().min(1).optional(),
    status: AllocationStatusSchema.optional(),
});
export const ManagerEditSchema = z.object({
    streams: z.array(WorkStreamDataSchema),
    // editorId/editorName are NEVER accepted from the client — they're derived
    // from the authenticated session to prevent privilege spoofing.
    clearFlags: z.boolean().optional().default(true),
});
//# sourceMappingURL=allocations.js.map