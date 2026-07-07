/**
 * scripts/backfill-flag-loss.ts
 *
 * One-time repair for the "card flags wiped by autosave" bug (see
 * scripts/diagnose-flag-loss.ts for the diagnosis and reconstruction rules).
 *
 * Replays each record's flag/unflag/submit/manager-edit audit trail to
 * reconstruct the flags that SHOULD be on its cards, then re-populates
 * AllocationActivity.flagReason / flaggedAt where the live column is missing or
 * mismatched. Because upsertDraft (the autosave that did the wiping) writes no
 * AuditLog row, the flag audit trail is an untouched source of truth.
 *
 * CONSERVATIVE — fill/repair only:
 *   - Restores a flag ONLY onto an activity that still exists and whose intended
 *     reason differs from the DB (missing, or a stale earlier reason).
 *   - NEVER removes a flag that is currently present (even if the audit trail
 *     says it should be gone — those are surfaced as "stale" by the diagnostic
 *     for manual review, not auto-deleted here).
 *   - Skips intended flags whose card was deleted since (nothing to write to).
 *
 * ⚠️  DEPLOY THE FIX FIRST. Until the flag-preserving upsertDraft is live, a
 * single employee edit will re-wipe anything this restores.
 *
 * DRY-RUN BY DEFAULT — prints what it WOULD change and writes nothing.
 * Pass --apply to write (one transaction per record + an AuditLog row,
 * action 'backfill-flags', userId null = system event).
 *
 *   npx tsx scripts/backfill-flag-loss.ts           # preview
 *   npx tsx scripts/backfill-flag-loss.ts --apply   # restore
 *
 * Uses the app's own prisma singleton so the datasource matches the server.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { logAuditTx } from '../src/lib/audit.js';

const APPLY = process.argv.includes('--apply');

type IntendedFlag = { reason: string; flaggedAt: Date };
type IntendedMap = Map<string, IntendedFlag>;

const FLAG_ACTIONS = ['flag', 'unflag', 'submit', 'manager-edit'] as const;

function reconstruct(
  events: Array<{
    action: string;
    activityId: string | null;
    reason: string | null;
    clearFlags: boolean;
    createdAt: Date;
  }>,
): IntendedMap {
  const map: IntendedMap = new Map();
  for (const e of events) {
    switch (e.action) {
      case 'flag':
        if (e.activityId && e.reason) {
          map.set(e.activityId, { reason: e.reason, flaggedAt: e.createdAt });
        }
        break;
      case 'unflag':
        if (e.activityId) map.delete(e.activityId);
        break;
      case 'submit':
        map.clear();
        break;
      case 'manager-edit':
        if (e.clearFlags) map.clear();
        break;
    }
  }
  return map;
}

async function main() {
  console.log(`\n=== Flag-loss backfill (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log('Restoring wiped per-card flags from the audit trail. Fill/repair only — never removes flags.\n');

  const logs = await prisma.auditLog.findMany({
    where: { action: { in: FLAG_ACTIONS as unknown as string[] } },
    orderBy: { createdAt: 'asc' },
  });

  const eventsByRecord = new Map<
    string,
    Array<{
      action: string;
      activityId: string | null;
      reason: string | null;
      clearFlags: boolean;
      createdAt: Date;
    }>
  >();

  for (const log of logs) {
    const payload = (log.payload ?? {}) as Record<string, unknown>;
    const isActivityEvent = log.action === 'flag' || log.action === 'unflag';
    const recordId = isActivityEvent
      ? (typeof payload.recordId === 'string' ? payload.recordId : null)
      : log.entityId;
    if (!recordId) continue;

    const bucket = eventsByRecord.get(recordId) ?? [];
    bucket.push({
      action: log.action,
      activityId: isActivityEvent ? log.entityId : null,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
      clearFlags: payload.clearFlags !== false,
      createdAt: log.createdAt,
    });
    eventsByRecord.set(recordId, bucket);
  }

  const records = await prisma.allocationRecord.findMany({
    where: { id: { in: [...eventsByRecord.keys()] } },
    include: {
      activities: { select: { id: true, flagReason: true, workType: true, client: true } },
      employee: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ year: 'asc' }, { monthIndex: 'asc' }],
  });

  // Build the concrete per-activity writes.
  type Write = {
    recordId: string;
    employee: string;
    period: string;
    status: string;
    activityId: string;
    card: string;
    reason: string;
    flaggedAt: Date;
  };
  const writes: Write[] = [];

  for (const r of records) {
    const intended = reconstruct(eventsByRecord.get(r.id) ?? []);
    if (intended.size === 0) continue;

    const byId = new Map(r.activities.map((a) => [a.id, a]));

    for (const [activityId, flag] of intended) {
      const activity = byId.get(activityId);
      if (!activity) continue; // card deleted — nothing to restore
      if (activity.flagReason === flag.reason) continue; // already correct

      writes.push({
        recordId: r.id,
        employee: `${r.employee.firstName} ${r.employee.lastName}`,
        period: `${r.month} ${r.year}`,
        status: r.status,
        activityId,
        card: [activity.workType, activity.client].filter(Boolean).join(' · ') || 'card',
        reason: flag.reason,
        flaggedAt: flag.flaggedAt,
      });
    }
  }

  if (writes.length === 0) {
    console.log('✅ Nothing to restore — every intended flag is already present on its card.\n');
    return;
  }

  console.table(
    writes.map((w) => ({
      record: w.recordId,
      employee: w.employee,
      period: w.period,
      status: w.status,
      card: w.card,
      reason: w.reason.length > 50 ? w.reason.slice(0, 47) + '…' : w.reason,
    })),
  );

  const recordCount = new Set(writes.map((w) => w.recordId)).size;

  if (!APPLY) {
    console.log(
      `\n${writes.length} flag(s) across ${recordCount} record(s) WOULD be restored. ` +
        `Re-run with --apply to write. (Dry-run — no changes made.)\n`,
    );
    return;
  }

  // Apply: group writes per record, one transaction each (activity updates +
  // a single audit row summarising the restore).
  const byRecord = new Map<string, Write[]>();
  for (const w of writes) {
    const bucket = byRecord.get(w.recordId) ?? [];
    bucket.push(w);
    byRecord.set(w.recordId, bucket);
  }

  let restored = 0;
  for (const [recordId, group] of byRecord) {
    await prisma.$transaction(async (tx) => {
      for (const w of group) {
        await tx.allocationActivity.update({
          where: { id: w.activityId },
          data: { flagReason: w.reason, flaggedAt: w.flaggedAt },
        });
      }
      await logAuditTx(tx, {
        userId: null, // system-generated backfill
        action: 'backfill-flags',
        entity: 'AllocationRecord',
        entityId: recordId,
        payload: {
          reason: 'flag-loss backfill (reconstructed from flag/unflag audit trail)',
          restored: group.map((w) => ({ activityId: w.activityId, reason: w.reason })),
        },
      });
    });
    restored += group.length;
  }

  console.log(
    `\n✅ Restored ${restored} flag(s) across ${byRecord.size} record(s). ` +
      `Audit rows written (action='backfill-flags').\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
