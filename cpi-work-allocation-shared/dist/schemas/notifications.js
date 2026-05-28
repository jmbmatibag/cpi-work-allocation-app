import { z } from 'zod';
/**
 * Payload for POST /api/notifications/submission-reminder.
 *
 * Identity comes from the session (req.userId on the API). The body
 * only carries the calendar period the in-app reminder fired for so
 * the email subject and body match the alert the user just saw.
 */
export const SubmissionReminderSchema = z.object({
    month: z.string().min(1),
    year: z.string().regex(/^\d{4}$/, 'Year must be YYYY'),
    monthIndex: z.number().int().min(0).max(11),
});
//# sourceMappingURL=notifications.js.map