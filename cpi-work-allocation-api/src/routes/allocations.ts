import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  UpsertDraftSchema,
  ReturnForRevisionSchema,
  ApproveAllocationSchema,
  SubmitAllocationSchema,
  FlagActivitySchema,
  ManagerEditSchema,
  ListAllocationsQuerySchema,
  IdParamSchema,
  AllocationActivityParamsSchema,
} from 'cpi-work-allocation-shared';
import * as ctrl from '../controllers/allocations.js';

const router = Router();
router.use(requireAuth);

const managerOrAbove = requireRole('Manager', 'Finance', 'Admin');

router.post('/', validate(UpsertDraftSchema), ctrl.upsertDraft);
router.get('/', validate(ListAllocationsQuerySchema, 'query'), ctrl.list);
router.get('/:id', validate(IdParamSchema, 'params'), ctrl.getOne);
// Read-only audit timeline for one record. Authorization is enforced inside
// the controller (self / direct manager / global / same-team peer), so no
// role gate here — an employee can see the history of their own allocation.
router.get('/:id/history', validate(IdParamSchema, 'params'), ctrl.history);

router.post(
  '/:id/submit',
  validate(IdParamSchema, 'params'),
  validate(SubmitAllocationSchema),
  ctrl.submit,
);
router.post(
  '/:id/approve',
  managerOrAbove,
  validate(IdParamSchema, 'params'),
  validate(ApproveAllocationSchema),
  ctrl.approve
);
router.post(
  '/:id/return',
  managerOrAbove,
  validate(IdParamSchema, 'params'),
  validate(ReturnForRevisionSchema),
  ctrl.returnForRevision
);
router.post(
  '/:id/manager-edit',
  managerOrAbove,
  validate(IdParamSchema, 'params'),
  validate(ManagerEditSchema),
  ctrl.managerEdit
);

router.patch(
  '/:id/activities/:activityId/flag',
  managerOrAbove,
  validate(AllocationActivityParamsSchema, 'params'),
  validate(FlagActivitySchema),
  ctrl.flagActivity
);
router.delete(
  '/:id/activities/:activityId/flag',
  managerOrAbove,
  validate(AllocationActivityParamsSchema, 'params'),
  ctrl.unflagActivity
);

export default router;
