import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as ctrl from '../controllers/notifications.js';
import {
  ManualReminderSchema,
  CreateSelfNotificationSchema,
  NotificationIdParamSchema,
} from '../controllers/notifications.js';

const router = Router();
router.use(requireAuth);

// ── In-app notification (bell) endpoints — any authenticated user ────────────
// All are implicitly scoped to the caller (req.userId); a user can only ever
// read or mutate their own notifications.
router.get('/', ctrl.list);
router.post('/', validate(CreateSelfNotificationSchema), ctrl.createSelf);
router.post('/read-all', ctrl.markAllRead);
router.patch(
  '/:id/read',
  validate(NotificationIdParamSchema, 'params'),
  ctrl.markRead,
);

// ── Manual reminders — Finance/Admin only ────────────────────────────────────
// Managers can't blast their peers, and employees certainly can't.
const financeOrAdmin = requireRole('Finance', 'Admin');

router.post(
  '/manual-reminder',
  financeOrAdmin,
  validate(ManualReminderSchema),
  ctrl.manualReminder,
);

export default router;
