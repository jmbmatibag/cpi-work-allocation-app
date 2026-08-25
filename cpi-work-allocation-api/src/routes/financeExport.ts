import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { FinanceExportQuerySchema } from 'cpi-work-allocation-shared';
import * as ctrl from '../controllers/financeExport.js';

const router = Router();
router.use(requireAuth);

// Global-scope roles only. This endpoint returns EVERY employee's allocation
// for a period in one response, so it must never be reachable by a Manager
// (team scope) or an Employee (self scope) — unlike /api/allocations, there
// is no per-record scope filter to fall back on.
router.get(
  '/',
  requireRole('Finance', 'Admin'),
  validate(FinanceExportQuerySchema, 'query'),
  ctrl.exportForFinance,
);

export default router;
