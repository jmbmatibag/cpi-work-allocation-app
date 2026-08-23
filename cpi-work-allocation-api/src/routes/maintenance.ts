import { Router } from 'express';
import { UpdateMaintenanceSchema } from 'cpi-work-allocation-shared';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as ctrl from '../controllers/maintenance.js';

const router = Router();

// NOTE: no router-level requireAuth here (unlike every other router). The GET
// is deliberately public — a signed-out browser must be able to render the
// announcement page. Auth is applied per-route on the write below instead.

// Public read — polled by every client to decide whether to show the gate.
router.get('/', ctrl.getStatus);

// Admin-only write — flips the switch and edits the announcement copy.
router.put(
  '/',
  requireAuth,
  requireRole('Admin'),
  validate(UpdateMaintenanceSchema),
  ctrl.updateStatus,
);

export default router;
