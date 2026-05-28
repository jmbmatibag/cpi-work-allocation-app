import { z } from 'zod';
/**
 * Payload for POST /api/notifications/submission-reminder.
 *
 * Identity comes from the session (req.userId on the API). The body
 * only carries the calendar period the in-app reminder fired for so
 * the email subject and body match the alert the user just saw.
 */
export declare const SubmissionReminderSchema: z.ZodObject<{
    month: z.ZodString;
    year: z.ZodString;
    monthIndex: z.ZodNumber;
}, z.core.$strip>;
export type SubmissionReminderInput = z.infer<typeof SubmissionReminderSchema>;
//# sourceMappingURL=notifications.d.ts.map