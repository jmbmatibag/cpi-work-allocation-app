import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  UpsertJournalEntrySchema,
  ListJournalQuerySchema,
  DateParamSchema,
} from 'cpi-work-allocation-shared';
import * as ctrl from '../controllers/journal.js';

const router = Router();
router.use(requireAuth);

router.get('/', validate(ListJournalQuerySchema, 'query'), ctrl.list);
router.get('/:date', validate(DateParamSchema, 'params'), ctrl.getByDate);
router.put(
  '/:date',
  validate(DateParamSchema, 'params'),
  validate(UpsertJournalEntrySchema),
  ctrl.upsertByDate
);
router.delete('/:date', validate(DateParamSchema, 'params'), ctrl.deleteByDate);

export default router;
