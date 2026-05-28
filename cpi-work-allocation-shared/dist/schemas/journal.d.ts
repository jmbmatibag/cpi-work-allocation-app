import { z } from 'zod';
export declare const TimeBlockSchema: z.ZodObject<{
    id: z.ZodString;
    startTime: z.ZodString;
    endTime: z.ZodString;
    description: z.ZodString;
}, z.core.$strip>;
export declare const UpsertJournalEntrySchema: z.ZodObject<{
    content: z.ZodString;
    blocks: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        startTime: z.ZodString;
        endTime: z.ZodString;
        description: z.ZodString;
    }, z.core.$strip>>>>;
}, z.core.$strip>;
export declare const ListJournalQuerySchema: z.ZodObject<{
    employeeId: z.ZodOptional<z.ZodString>;
    year: z.ZodOptional<z.ZodString>;
    month: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TimeBlock = z.infer<typeof TimeBlockSchema>;
export type UpsertJournalEntryInput = z.infer<typeof UpsertJournalEntrySchema>;
export type ListJournalQuery = z.infer<typeof ListJournalQuerySchema>;
//# sourceMappingURL=journal.d.ts.map