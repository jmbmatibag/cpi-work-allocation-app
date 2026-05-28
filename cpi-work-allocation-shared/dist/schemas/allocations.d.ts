import { z } from 'zod';
/**
 * Activity = one row inside a workstream (e.g. "Security work for AUII").
 * Exported so the frontend can z.infer<typeof ActivityDataSchema> and
 * stop maintaining a duplicate ActivityData interface.
 */
export declare const ActivityDataSchema: z.ZodObject<{
    id: z.ZodString;
    team: z.ZodString;
    workCategory: z.ZodString;
    subCategory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    workType: z.ZodString;
    client: z.ZodString;
    description: z.ZodString;
    percentage: z.ZodNumber;
    expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
/**
 * Workstream = grouped activities under a category (IT, Projects, etc.).
 * Exported alongside ActivityDataSchema for the same reason.
 */
export declare const WorkStreamDataSchema: z.ZodObject<{
    category: z.ZodString;
    activities: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        team: z.ZodString;
        workCategory: z.ZodString;
        subCategory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        workType: z.ZodString;
        client: z.ZodString;
        description: z.ZodString;
        percentage: z.ZodNumber;
        expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>;
    expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export declare const UpsertDraftSchema: z.ZodObject<{
    employeeId: z.ZodString;
    team: z.ZodString;
    managerId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    month: z.ZodString;
    year: z.ZodString;
    monthIndex: z.ZodNumber;
    streams: z.ZodArray<z.ZodObject<{
        category: z.ZodString;
        activities: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            team: z.ZodString;
            workCategory: z.ZodString;
            subCategory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            workType: z.ZodString;
            client: z.ZodString;
            description: z.ZodString;
            percentage: z.ZodNumber;
            expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        }, z.core.$strip>>;
        expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ReturnForRevisionSchema: z.ZodObject<{
    feedback: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const SubmitAllocationSchema: z.ZodDefault<z.ZodObject<{
    streams: z.ZodOptional<z.ZodArray<z.ZodObject<{
        category: z.ZodString;
        activities: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            team: z.ZodString;
            workCategory: z.ZodString;
            subCategory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            workType: z.ZodString;
            client: z.ZodString;
            description: z.ZodString;
            percentage: z.ZodNumber;
            expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        }, z.core.$strip>>;
        expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>>;
}, z.core.$strip>>;
export declare const FlagActivitySchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export declare const AllocationStatusSchema: z.ZodEnum<{
    Draft: "Draft";
    PendingReview: "PendingReview";
    Approved: "Approved";
    NeedsRevision: "NeedsRevision";
}>;
export declare const ListAllocationsQuerySchema: z.ZodObject<{
    employeeId: z.ZodOptional<z.ZodString>;
    managerId: z.ZodOptional<z.ZodString>;
    month: z.ZodOptional<z.ZodString>;
    year: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        Draft: "Draft";
        PendingReview: "PendingReview";
        Approved: "Approved";
        NeedsRevision: "NeedsRevision";
    }>>;
}, z.core.$strip>;
export declare const ManagerEditSchema: z.ZodObject<{
    streams: z.ZodArray<z.ZodObject<{
        category: z.ZodString;
        activities: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            team: z.ZodString;
            workCategory: z.ZodString;
            subCategory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            workType: z.ZodString;
            client: z.ZodString;
            description: z.ZodString;
            percentage: z.ZodNumber;
            expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        }, z.core.$strip>>;
        expanded: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>;
    clearFlags: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export type ActivityData = z.infer<typeof ActivityDataSchema>;
export type WorkStreamData = z.infer<typeof WorkStreamDataSchema>;
export type UpsertDraftInput = z.infer<typeof UpsertDraftSchema>;
export type ReturnForRevisionInput = z.infer<typeof ReturnForRevisionSchema>;
export type SubmitAllocationInput = z.infer<typeof SubmitAllocationSchema>;
export type FlagActivityInput = z.infer<typeof FlagActivitySchema>;
export type ListAllocationsQuery = z.infer<typeof ListAllocationsQuerySchema>;
export type ManagerEditInput = z.infer<typeof ManagerEditSchema>;
export type AllocationStatusWire = z.infer<typeof AllocationStatusSchema>;
//# sourceMappingURL=allocations.d.ts.map