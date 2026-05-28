import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  AddNameSchema,
  RenameSchema,
  AddSubCategorySchema,
  SetSubCategoryClientsSchema,
  AddWorkTypeSchema,
  SetWorkTypeParentsSchema,
  BulkInferenceRulesSchema,
  NumericIdParamSchema,
} from 'cpi-work-allocation-shared';
import * as ctrl from '../controllers/settings.js';

const router = Router();
router.use(requireAuth);
const adminOnly = requireRole('Admin');

// Full taxonomy snapshot — available to any authenticated user.
router.get('/', ctrl.snapshot);

// ── Teams ─────────────────────────────────────────────────────────────────
router.post('/teams', adminOnly, validate(AddNameSchema), ctrl.createTeam);
router.put(
  '/teams/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  validate(RenameSchema),
  ctrl.renameTeam
);
router.delete(
  '/teams/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  ctrl.deleteTeam
);

// ── Clients ───────────────────────────────────────────────────────────────
router.post('/clients', adminOnly, validate(AddNameSchema), ctrl.createClient);
router.put(
  '/clients/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  validate(RenameSchema),
  ctrl.renameClient
);
router.delete(
  '/clients/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  ctrl.deleteClient
);

// ── Main Categories ───────────────────────────────────────────────────────
router.post('/main-categories', adminOnly, validate(AddNameSchema), ctrl.createMainCategory);
router.put(
  '/main-categories/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  validate(RenameSchema),
  ctrl.renameMainCategory
);
router.delete(
  '/main-categories/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  ctrl.deleteMainCategory
);

// ── Sub-categories ────────────────────────────────────────────────────────
router.post(
  '/sub-categories',
  adminOnly,
  validate(AddSubCategorySchema),
  ctrl.createSubCategory
);
router.put(
  '/sub-categories/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  validate(RenameSchema),
  ctrl.renameSubCategory
);
router.patch(
  '/sub-categories/:id/clients',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  validate(SetSubCategoryClientsSchema),
  ctrl.setSubCategoryClients
);
router.delete(
  '/sub-categories/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  ctrl.deleteSubCategory
);

// ── Work Types ────────────────────────────────────────────────────────────
router.post('/work-types', adminOnly, validate(AddWorkTypeSchema), ctrl.createWorkType);
router.put(
  '/work-types/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  validate(RenameSchema),
  ctrl.renameWorkType
);
router.patch(
  '/work-types/:id/parents',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  validate(SetWorkTypeParentsSchema),
  ctrl.setWorkTypeParents
);
router.delete(
  '/work-types/:id',
  adminOnly,
  validate(NumericIdParamSchema, 'params'),
  ctrl.deleteWorkType
);

// ── Inference Rules (bulk replace) ───────────────────────────────────────
router.put(
  '/inference-rules',
  adminOnly,
  validate(BulkInferenceRulesSchema),
  ctrl.bulkReplaceInferenceRules
);

export default router;
