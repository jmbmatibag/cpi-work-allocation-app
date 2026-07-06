import type { Response } from 'express';
import { prisma } from '../lib/prisma.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import { AddPeerTabSchema, PeerManagerIdParamSchema } from 'cpi-work-allocation-shared';
import type { PeerManagerDto } from 'cpi-work-allocation-shared';

const PEER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  team: true,
  jobTitle: true,
} as const;

function toPeerDto(u: {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
  jobTitle: string;
}): PeerManagerDto {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    team: u.team,
    jobTitle: u.jobTitle,
  };
}

/**
 * Load the requesting user's team + roles once. Peer coverage is a
 * Manager-only capability, so callers without the Manager role get an empty
 * eligible-peer set (the UI simply shows no "+" options).
 */
async function getRequester(userId: string | undefined) {
  if (!userId) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, team: true, roles: true },
  });
}

/**
 * GET /api/managers/peers
 *
 * Eligible peer managers for the caller: everyone on the SAME team who
 * carries the Manager role, excluding the caller themselves. This is the
 * source list for the "+" popover in Team Hub.
 */
export async function listPeers(req: AuthRequest, res: Response): Promise<void> {
  const me = await getRequester(req.userId);
  if (!me || !me.roles.includes('Manager')) {
    res.json([]);
    return;
  }

  const peers = await prisma.user.findMany({
    where: {
      team: me.team,
      id: { not: me.id },
      roles: { has: 'Manager' },
    },
    select: PEER_SELECT,
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  res.json(peers.map(toPeerDto));
}

/**
 * GET /api/managers/peer-tabs
 *
 * The caller's persisted peer-coverage tabs. Rows whose peer is no longer a
 * valid same-team manager (team change, role removal, deletion) are filtered
 * out AND pruned so the list self-heals over time.
 */
export async function listPeerTabs(req: AuthRequest, res: Response): Promise<void> {
  const me = await getRequester(req.userId);
  if (!me || !me.roles.includes('Manager')) {
    res.json([]);
    return;
  }

  const tabs = await prisma.peerCoverageTab.findMany({
    where: { managerId: me.id },
    include: { peer: { select: { ...PEER_SELECT, roles: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Re-validate each pinned peer against the LIVE eligibility rule
  // (same team + Manager role). Drift (team move, role removal) prunes the
  // stale row so the list self-heals.
  const valid: PeerManagerDto[] = [];
  const staleIds: string[] = [];
  for (const t of tabs) {
    const p = t.peer;
    if (p && p.id !== me.id && p.team === me.team && p.roles.includes('Manager')) {
      valid.push(toPeerDto(p));
    } else {
      staleIds.push(t.peerManagerId);
    }
  }

  if (staleIds.length > 0) {
    await prisma.peerCoverageTab.deleteMany({
      where: { managerId: me.id, peerManagerId: { in: staleIds } },
    });
  }

  res.json(valid);
}

/**
 * POST /api/managers/peer-tabs  { peerManagerId }
 *
 * Pin a peer tab. Enforces the business rule: the target must be a DISTINCT
 * same-team manager. Idempotent — re-adding an existing peer is a no-op that
 * still returns 200 with the peer DTO.
 */
export async function addPeerTab(req: AuthRequest, res: Response): Promise<void> {
  const { peerManagerId } = getValid(req, AddPeerTabSchema);

  const me = await getRequester(req.userId);
  if (!me || !me.roles.includes('Manager')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (peerManagerId === me.id) {
    res.status(400).json({ error: 'CANNOT_ADD_SELF' });
    return;
  }

  const peer = await prisma.user.findUnique({
    where: { id: peerManagerId },
    select: { ...PEER_SELECT, roles: true },
  });
  if (!peer) {
    res.status(404).json({ error: 'Peer manager not found' });
    return;
  }
  if (peer.team !== me.team || !peer.roles.includes('Manager')) {
    // Same-team + Manager is the whole eligibility rule.
    res.status(400).json({ error: 'NOT_A_SAME_TEAM_PEER' });
    return;
  }

  await prisma.peerCoverageTab.upsert({
    where: { managerId_peerManagerId: { managerId: me.id, peerManagerId } },
    create: { managerId: me.id, peerManagerId },
    update: {},
  });

  res.status(201).json(toPeerDto(peer));
}

/**
 * DELETE /api/managers/peer-tabs/:peerManagerId
 *
 * Unpin a peer tab. 204 whether or not the row existed (idempotent close).
 */
export async function removePeerTab(req: AuthRequest, res: Response): Promise<void> {
  const { peerManagerId } = getValid(req, PeerManagerIdParamSchema, 'params');

  await prisma.peerCoverageTab.deleteMany({
    where: { managerId: req.userId, peerManagerId },
  });

  res.status(204).send();
}
