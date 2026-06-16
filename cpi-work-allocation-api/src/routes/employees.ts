import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  IdParamSchema,
} from 'cpi-work-allocation-shared';
import * as ctrl from '../controllers/employees.js';
import * as importCtrl from '../controllers/employeesImport.js';

const router = Router();
router.use(requireAuth);

const adminOnly = requireRole('Admin');

router.get('/', ctrl.list);
// CSV import: two-stage (pre-flight analyze, then SSE execute). Declared
// before '/:id' so the literal '/import/*' paths win the match.
router.post('/import/analyze', adminOnly, importCtrl.analyzeImport);
router.get('/import/execute', adminOnly, importCtrl.executeImport);
router.get('/:id', validate(IdParamSchema, 'params'), ctrl.getOne);
// Bulk operations — must be declared before /:id POST routes to avoid path conflicts
router.post('/bulk-delete', adminOnly, ctrl.bulkDelete);
router.post('/bulk-resend-welcome', adminOnly, ctrl.bulkResendWelcome);
router.post('/', adminOnly, validate(CreateEmployeeSchema), ctrl.create);
router.put(
  '/:id',
  adminOnly,
  validate(IdParamSchema, 'params'),
  validate(UpdateEmployeeSchema),
  ctrl.update
);
router.delete('/:id', adminOnly, validate(IdParamSchema, 'params'), ctrl.remove);

export default router;
