/**
 * scripts/diagnose-flag-loss.ts
 *
 * READ-ONLY diagnostic for the "card flags wiped by autosave" bug.
 *
 * Background: per-card manager flags live on AllocationActivity.flagReason /
 * flaggedAt. The employee autosave (upsertDraft) delete+recreated activity rows
 * WITHOUT carrying those columns, so any employee edit after a return silently
 * wiped every flag. Crucially, upsertDraft writes NO AuditLog row — so the
 * flag/unflag audit trail is an untouched, faithful record of intended state.
 *
 * This script replays each record's audit trail to reconstruct the flags that
 * SHOULD be present, compares that to the live columns, and classifies every
 * record. It writes NOTHING. Use it to size the blast radius before running
 * scripts/backfill-flag-loss.ts.
 *
 *   npx tsx scripts/diagnose-flag-loss.ts            # summary + records needing restore
 *   npx tsx scripts/diagnose-flag-loss.ts --verbose  # also list intact / informational rows
 *
 * Reconstruction rules (chronological replay per record):
 *   flag         → set    flag[activityId] = { reason, flaggedAt: event.createdAt }
 *   unflag       → clear   flag[activityId]
 *   submit       → clear ALL   (a resubmit is the intended flag-clear boundary)
 *   manager-edit → clear ALL   unless payload.clearFlags === false
 *   approve/return → no effect on flags
 *
 * Uses the app's own prisma singleton so the datasource matches the server.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const VERBOSE = process.argv.includes('--verbose');

type IntendedFlag = { reason: string; flaggedAt: Date };
type IntendedMap = Map<string, IntendedFlag>; // activityId -> flag

// Actions that can affect the flag state, oldest-first replay.
const FLAG_ACTIONS = ['flag', 'unflag', 'submit', 'manager-edit'] as const;

/**
 * Replay one record's flag-affecting audit events (already sorted oldest-first)
 * into the net set of intended flags.
 */
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
  console.log(`\n=== Flag-loss diagnostic (READ-ONLY${VERBOSE ? ', verbose' : ''}) ===`);
  console.log(
    'Reconstructing intended per-card flags from the audit trail and comparing to live columns.\n',
  );

  // 1. Every flag-affecting audit row, oldest first, bucketed by record id.
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
    // flag/unflag: recordId lives in the payload, entityId is the activity.
    // submit/manager-edit: entity is the record itself.
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
      // clearFlags defaults to true when omitted (matches ManagerEditSchema).
      clearFlags: payload.clearFlags !== false,
      createdAt: log.createdAt,
    });
    eventsByRecord.set(recordId, bucket);
  }

  // 2. Load the records that have any flag history, with their live activities.
  const records = await prisma.allocationRecord.findMany({
    where: { id: { in: [...eventsByRecord.keys()] } },
    include: {
      activities: { select: { id: true, flagReason: true, workType: true, client: true } },
      employee: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: [{ year: 'asc' }, { monthIndex: 'asc' }],
  });

  const needsRestore: Array<Record<string, unknown>> = [];
  const informational: Array<Record<string, unknown>> = [];
  let intactRecords = 0;

  for (const r of records) {
    const intended = reconstruct(eventsByRecord.get(r.id) ?? []);
    if (intended.size === 0) continue; // nothing was ever meant to be flagged now

    const activityIds = new Set(r.activities.map((a) => a.id));
    const currentReasonById = new Map(
      r.activities.filter((a) => a.flagReason).map((a) => [a.id, a.flagReason as string]),
    );

    let toRestore = 0; // intended, activity exists, DB missing/mismatched
    let gone = 0; // intended but the activity no longer exists (card deleted)
    let alreadyCorrect = 0;

    for (const [activityId, flag] of intended) {
      if (!activityIds.has(activityId)) {
        gone += 1;
        continue;
      }
      if (currentReasonById.get(activityId) === flag.reason) {
        alreadyCorrect += 1;
      } else {
        toRestore += 1;
      }
    }

    // Flags present in the DB that the audit trail says should NOT be there
    // (e.g. a later unflag/submit). Informational only — the backfill never
    // removes these.
    let stalePresent = 0;
    for (const activityId of currentReasonById.keys()) {
      if (!intended.has(activityId)) stalePresent += 1;
    }

    const row = {
      id: r.id,
      employee: `${r.employee.firstName} ${r.employee.lastName}`,
      period: `${r.month} ${r.year}`,
      status: r.status,
      intended: intended.size,
      restore: toRestore,
      cardGone: gone,
      stale: stalePresent,
    };

    if (toRestore > 0) needsRestore.push(row);
    else if (gone > 0 || stalePresent > 0) informational.push(row);
    else intactRecords += 1;
  }

  // 3. Report.
  console.log('── Records needing flag restore ──');
  if (needsRestore.length === 0) {
    console.log('✅ None — every intended flag is already present on its card.\n');
  } else {
    console.table(needsRestore);
    console.log(
      `\n⚠️  ${needsRestore.length} record(s) have flags the audit trail says should be on a ` +
        `card but the live column is missing/mismatched. Run backfill-flag-loss.ts --apply to restore.\n`,
    );
  }

  console.log('── Summary ──');
  console.table([
    { metric: 'records with flag history', count: records.length },
    { metric: 'records needing restore', count: needsRestore.length },
    { metric: 'records intact (flags correct)', count: intactRecords },
    { metric: 'records with only informational notes', count: informational.length },
  ]);

  if (VERBOSE && informational.length > 0) {
    console.log(
      '\n── Informational (card deleted since flagged = cardGone; DB flag with no audit backing = stale) ──',
    );
    console.table(informational);
  }

  console.log('\n(Read-only — no changes were made.)\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
