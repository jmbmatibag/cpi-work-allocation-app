import { z } from 'zod';
/**
 * Body for PUT /api/maintenance (Admin only).
 *
 * `enabled` is the only required field — flipping the switch shouldn't force
 * the admin to re-send the copy. Every other field is a partial patch: omit
 * it to keep the stored value, send null on the timestamps to clear a window.
 */
export declare const UpdateMaintenanceSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    title: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    startsAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    endsAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
/** Public shape returned by GET /api/maintenance and PUT /api/maintenance. */
export declare const MaintenanceStatusSchema: z.ZodObject<{
    enabled: z.ZodBoolean;
    title: z.ZodString;
    message: z.ZodString;
    startsAt: z.ZodNullable<z.ZodString>;
    endsAt: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    updatedByName: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type UpdateMaintenanceInput = z.infer<typeof UpdateMaintenanceSchema>;
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusSchema>;
//# sourceMappingURL=maintenance.d.ts.map