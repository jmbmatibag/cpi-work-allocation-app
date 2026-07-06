import { z } from 'zod';
/**
 * Peer Coverage — request shapes for the /api/managers/* endpoints.
 *
 * A manager can pin "peer tabs" onto their Team Hub to view and action a
 * same-team peer manager's submissions. These schemas cover adding and
 * removing those persisted tabs. The eligibility rule (same Team, Manager
 * role, not self) is enforced server-side against the live User table — the
 * client only ever sends the target peer's id.
 */
export const AddPeerTabSchema = z.object({
    peerManagerId: z.string().min(1),
});
// The :peerManagerId route param on DELETE /api/managers/peer-tabs/:peerManagerId
export const PeerManagerIdParamSchema = z.object({
    peerManagerId: z.string().min(1),
});
//# sourceMappingURL=managers.js.map