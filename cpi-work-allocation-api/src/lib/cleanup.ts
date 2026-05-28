import { prisma } from './prisma.js';

// Delete refresh tokens that expired or were revoked more than 30 days ago.
// Revoked tokens must be kept briefly so reuse-detection (which looks up
// revokedAt + replacedById) can still fire for the rotation window. After 30
// days any session lineage investigation is moot.
const REVOKED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeStaleTokens(): Promise<void> {
  const cutoff = new Date(Date.now() - REVOKED_GRACE_MS);
  const { count } = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        // Already expired AND past the grace window
        { expiresAt: { lt: cutoff } },
        // Revoked (logout / rotation) AND past the grace window
        { revokedAt: { lt: cutoff } },
      ],
    },
  });
  if (count > 0) {
    console.log(`[cleanup] Purged ${count} stale refresh token(s)`);
  }
}

// Run the purge once on startup, then every 6 hours.
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function startCleanupScheduler(): void {
  purgeStaleTokens().catch((e) => console.error('[cleanup] initial purge failed:', e));
  setInterval(() => {
    purgeStaleTokens().catch((e) => console.error('[cleanup] scheduled purge failed:', e));
  }, SIX_HOURS_MS).unref(); // .unref() so the interval doesn't keep the process alive
}
