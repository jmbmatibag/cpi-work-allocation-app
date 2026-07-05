/**
 * scripts/backfill-manager-desync.ts
 *
 * One-time repair for the manager-snapshot desync (see
 * scripts/diagnose-manager-desync.ts for the diagnosis). Fills the gap on the
 * denormalised AllocationRecord.managerId snapshot from the employee's CURRENT
 * live User.managerId.
 *
 * GENERAL + CONSERVATIVE, and data-driven (scans the whole table — NOT scoped
 * to any specific employees or periods):
 *   - Repairs records ACROSS ALL PERIODS for every affected employee — past
 *     and current — not just the current reporting month.
 *   - Only FILLS GAPS: a record is repaired solely when its managerId is NULL
 *     and the employee currently has a live manager. It NEVER overwrites a
 *     managerId that is already set (any existing pointer is preserved as-is)
 *     and never blanks one out.
 * (Deliberate reassignments are handled going forward by the cascade in the
 *  employees.ts update handler, which DOES overwrite every record.)
 *
 * DRY-RUN BY DEFAULT — prints what it WOULD change and writes nothing.
 * Pass --apply to perform the update (transactional, with an AuditLog row per
 * record, action 'backfill-manager', userId null = system event).
 *
 *   npx tsx scripts/backfill-manager-desync.ts           # preview all gaps
 *   npx tsx scripts/backfill-manager-desync.ts --apply   # fill all gaps
 *
 * Uses the app's own prisma singleton so the datasource matches the server.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { logAuditTx } from '../src/lib/audit.js';

const APPLY = process.argv.includes('--apply');

const fullName = (u: { firstName: string; lastName: string } | null): string =>
  u ? `${u.firstName} ${u.lastName}` : '';

async function main() {
  console.log(`\n=== Manager-desync backfill (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Rule: fill NULL AllocationRecord.managerId from live User.managerId; never overwrite an existing value\n`);

  const records = await prisma.allocationRecord.findMany({
    include: {
      employee: {
        select: { email: true, firstName: true, lastName: true, managerId: true },
      },
    },
    orderBy: [{ year: 'asc' }, { monthIndex: 'asc' }],
  });

  // Fill-the-gap only: the record has NO manager but the employee currently
  // does. Records that already carry a managerId are left untouched (never
  // overwritten), and we never write null. Spans every period, every employee.
  const targets = records.filter(
    (r) => r.managerId === null && r.employee.managerId !== null,
  );

  if (targets.length === 0) {
    console.log('✅ Nothing to backfill — no records with a NULL manager whose employee has a live manager.\n');
    return;
  }

  console.table(
    targets.map((r) => ({
      employee: fullName(r.employee),
      email: r.employee.email,
      period: `${r.month} ${r.year}`,
      status: r.status,
      from: '(null)',
      to: r.employee.managerId,
    })),
  );

  if (!APPLY) {
    console.log(
      `\n${targets.length} record(s) WOULD be updated. ` +
        `Re-run with --apply to write. (Dry-run — no changes made.)\n`,
    );
    return;
  }

  // Apply: one transaction, each record updated + audited atomically.
  let updated = 0;
  for (const r of targets) {
    await prisma.$transaction(async (tx) => {
      await tx.allocationRecord.update({
        where: { id: r.id },
        data: { managerId: r.employee.managerId },
      });
      await logAuditTx(tx, {
        userId: null, // system-generated backfill
        action: 'backfill-manager',
        entity: 'AllocationRecord',
        entityId: r.id,
        payload: {
          reason: 'manager-snapshot-desync backfill',
          fromManagerId: r.managerId,
          toManagerId: r.employee.managerId,
          period: `${r.month} ${r.year}`,
          employeeId: r.employeeId,
        },
      });
    });
    updated += 1;
  }

  console.log(`\n✅ Updated ${updated} record(s). Audit rows written (action='backfill-manager').\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
