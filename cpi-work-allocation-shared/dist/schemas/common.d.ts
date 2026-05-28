import { z } from 'zod';
export declare const IdParamSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const NumericIdParamSchema: z.ZodObject<{
    id: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const DateParamSchema: z.ZodObject<{
    date: z.ZodString;
}, z.core.$strip>;
export declare const AllocationActivityParamsSchema: z.ZodObject<{
    id: z.ZodString;
    activityId: z.ZodString;
}, z.core.$strip>;
export type IdParam = z.infer<typeof IdParamSchema>;
export type NumericIdParam = z.infer<typeof NumericIdParamSchema>;
export type DateParam = z.infer<typeof DateParamSchema>;
export type AllocationActivityParams = z.infer<typeof AllocationActivityParamsSchema>;
//# sourceMappingURL=common.d.ts.map