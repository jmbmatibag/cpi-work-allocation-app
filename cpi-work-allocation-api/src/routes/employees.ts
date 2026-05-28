import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  CreateEmployeeSchema,
  UpdateEmployeeSchema,
  IdParamSchema,
} from 'cpi-work-allocation-shared';
import * as ctrl from '../controllers/employees.js';

const router = Router();
router.use(requireAuth);

const adminOrHead = requireRole('Admin', 'Head');
const adminOnly = requireRole('Admin');

router.get('/', ctrl.list);
router.get('/:id', validate(IdParamSchema, 'params'), ctrl.getOne);
router.post('/', adminOrHead, validate(CreateEmployeeSchema), ctrl.create);
router.put(
  '/:id',
  adminOrHead,
  validate(IdParamSchema, 'params'),
  validate(UpdateEmployeeSchema),
  ctrl.update
);
router.delete('/:id', adminOnly, validate(IdParamSchema, 'params'), ctrl.remove);

export default router;
