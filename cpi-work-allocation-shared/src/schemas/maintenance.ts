import { z } from 'zod';

/**
 * Body for PUT /api/maintenance (Admin only).
 *
 * `enabled` is the only required field — flipping the switch shouldn't force
 * the admin to re-send the copy. Every other field is a partial patch: omit
 * it to keep the stored value, send null on the timestamps to clear a window.
 */
export const UpdateMaintenanceSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
  // ISO-8601 instants. Nullable so the UI can clear a previously set window;
  // `undefined` (omitted) leaves the stored value untouched.
  //
  // Deliberately `z.string().datetime()` and NOT zod 4's `z.iso.datetime()`:
  // the frontend resolves this package against its own zod 3.25, where
  // `z.iso` is undefined. Since the frontend imports the package root, every
  // schema module here gets evaluated in a v3 runtime — a v4-only builder
  // would throw at import time, not at validation time.
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/** Public shape returned by GET /api/maintenance and PUT /api/maintenance. */
export const MaintenanceStatusSchema = z.object({
  enabled: z.boolean(),
  title: z.string(),
  message: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
});

export type UpdateMaintenanceInput = z.infer<typeof UpdateMaintenanceSchema>;
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusSchema>;
