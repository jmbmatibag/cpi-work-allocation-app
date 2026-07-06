import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AddPeerTabSchema, PeerManagerIdParamSchema } from 'cpi-work-allocation-shared';
import * as ctrl from '../controllers/managers.js';

const router = Router();
router.use(requireAuth);

// Peer Coverage. Eligibility (same-team Manager) is enforced inside the
// controller against the live User table, so a plain requireAuth gate here
// is enough — non-managers simply get empty lists / 403 on mutations.
router.get('/peers', ctrl.listPeers);
router.get('/peer-tabs', ctrl.listPeerTabs);
router.post('/peer-tabs', validate(AddPeerTabSchema), ctrl.addPeerTab);
router.delete(
  '/peer-tabs/:peerManagerId',
  validate(PeerManagerIdParamSchema, 'params'),
  ctrl.removePeerTab,
);

export default router;
