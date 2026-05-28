import { z } from 'zod';
// String IDs (e.g. "ALC-2026-1020", "EMP001"). Required, non-empty.
export const IdParamSchema = z.object({
    id: z.string().min(1),
});
// Numeric IDs (taxonomy tables). Coerced from path string and bounded to
// positive integers — catches /teams/abc and /teams/-5 at the boundary
// instead of letting Prisma throw a validation error downstream.
export const NumericIdParamSchema = z.object({
    id: z.coerce.number().int().positive(),
});
// YYYY-MM-DD date param for journal routes. Matches the localStorage key
// format the frontend uses.
export const DateParamSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});
// Compound params for allocation activity routes.
export const AllocationActivityParamsSchema = z.object({
    id: z.string().min(1),
    activityId: z.string().min(1),
});
//# sourceMappingURL=common.js.map