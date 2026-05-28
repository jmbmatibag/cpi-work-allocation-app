import { z } from 'zod';
export const TimeBlockSchema = z.object({
    id: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    description: z.string(),
});
export const UpsertJournalEntrySchema = z.object({
    content: z.string(),
    blocks: z.array(TimeBlockSchema).nullable().optional(),
});
export const ListJournalQuerySchema = z.object({
    employeeId: z.string().min(1).optional(),
    // Year as 4-digit string and month as 1–12 string to match the existing
    // frontend query contract (parseInt + padStart happens in the handler).
    year: z.string().regex(/^\d{4}$/).optional(),
    month: z.string().regex(/^([1-9]|1[0-2])$/).optional(),
});
//# sourceMappingURL=journal.js.map