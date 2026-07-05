/**
 * scripts/diagnose-manager-desync.ts
 *
 * READ-ONLY diagnostic. Investigates why some employees (reported: Carl Matthew
 * Reyes, Jericho Ernest Sibayan, Juan Ricardo Eviota) land in the "Unassigned"
 * bucket on the Master Overview / Team Hub while Employee Management correctly
 * shows them under their manager (Andrew Robes).
 *
 * Two theories are tested against live data:
 *   Theory 1 — Relational desync: the employee's live User.managerId is null.
 *              (Schema-wise unlikely: there is no team_id/junction table; "team"
 *              is a plain string and the reporting line is the User.managerId
 *              self-FK, which Employee Management reads directly.)
 *   Theory 2 — Data snapshotting: AllocationRecord.managerId is a SNAPSHOT
 *              stamped at draft-create and refreshed only on submit. It is NOT
 *              updated when an admin reassigns the manager in Employee
 *              Management, so a record can keep a null/stale managerId while the
 *              live User.managerId points at the new manager. The Master
 *              Overview groups records by that snapshot → null → "Unassigned".
 *
 * Performs ZERO writes — safe to run against production at any time.
 *
 *   npx tsx scripts/diagnose-manager-desync.ts
 *   npx tsx scripts/diagnose-manager-desync.ts csreyes@cpi.com.ph jcsibayan@cpi.com.ph
 *   npx tsx scripts/diagnose-manager-desync.ts --month June --year 2026
 *
 * Uses the app's own prisma singleton so the datasource/connection config
 * matches the running server exactly.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

// Any bare arg containing "@" is treated as an affected-employee email.
const emailArgs = argv.filter((a) => a.includes('@'));
const AFFECTED = emailArgs.length
  ? emailArgs
  : ['csreyes@cpi.com.ph', 'jcsibayan@cpi.com.ph', 'jreviota@cpi.com.ph'];

// Reporting period defaults to the PREVIOUS calendar month (the app runs the
// approval lifecycle in arrears, so that's what the Master Overview shows).
const nowLocal = new Date();
const prevMonth = new Date(nowLocal.getFullYear(), nowLocal.getMonth() - 1, 1);
const MONTH = flag('--month') ?? MONTHS[prevMonth.getMonth()];
const YEAR = flag('--year') ?? String(prevMonth.getFullYear());

const fullName = (u: { firstName: string; lastName: string } | null): string =>
  u ? `${u.firstName} ${u.lastName}` : '';

/** Mirrors the SQL `record.managerId IS DISTINCT FROM user.managerId`. */
const classify = (
  recordManagerId: string | null,
  liveManagerId: string | null,
): 'ok' | 'STALE-NULL' | 'STALE-DIFF' => {
  if (recordManagerId === liveManagerId) return 'ok';
  if (recordManagerId === null && liveManagerId !== null) return 'STALE-NULL';
  return 'STALE-DIFF';
};

async function main() {
  console.log(`\n=== Manager-desync diagnostic (READ-ONLY) ===`);
  console.log(`Reporting period: ${MONTH} ${YEAR}`);
  console.log(`Affected emails : ${AFFECTED.join(', ')}\n`);

  // Resolve the affected employees with their live manager + every allocation
  // record (each with the manager as snapshotted on that record).
  const affectedUsers = await prisma.user.findMany({
    where: { email: { in: AFFECTED } },
    include: {
      manager: true, // live manager (User.managerId → "Reports")
      allocations: {
        include: { manager: true }, // snapshot manager (AllocationRecord.managerId)
        orderBy: [{ year: 'asc' }, { monthIndex: 'asc' }],
      },
    },
  });

  const missing = AFFECTED.filter(
    (e) => !affectedUsers.some((u) => u.email === e),
  );
  if (missing.length) {
    console.log(`⚠️  Not found in User table: ${missing.join(', ')}\n`);
  }

  // ── THEORY 1 — live User FK + team ─────────────────────────────────────────
  console.log('── THEORY 1: live User.managerId / team (what Employee Management shows) ──');
  console.table(
    affectedUsers.map((u) => ({
      employee: fullName(u),
      email: u.email,
      team: u.team,
      liveManagerId: u.managerId ?? '(null)',
      liveManager: fullName(u.manager) || '(none)',
      liveManagerIsNull: u.managerId === null,
    })),
  );
  const anyLiveNull = affectedUsers.some((u) => u.managerId === null);
  console.log(
    anyLiveNull
      ? '→ At least one live managerId IS null. Theory 1 is in play (broken live FK).'
      : '→ All live managerIds are set. Theory 1 disproven — check Theory 2 below.\n',
  );

  // ── THEORY 2 — allocation snapshot vs live FK ──────────────────────────────
  console.log('── THEORY 2: AllocationRecord.managerId snapshot vs live User.managerId ──');
  const snapshotRows = affectedUsers.flatMap((u) =>
    u.allocations.map((ar) => ({
      employee: fullName(u),
      period: `${ar.month} ${ar.year}`,
      status: ar.status,
      recordManagerId: ar.managerId ?? '(null)',
      recordManager: fullName(ar.manager) || '(Unassigned bucket)',
      liveManagerId: u.managerId ?? '(null)',
      liveManager: fullName(u.manager) || '(none)',
      submittedAt: ar.submittedAt?.toISOString().slice(0, 10) ?? '—',
      desync: classify(ar.managerId, u.managerId),
    })),
  );
  if (snapshotRows.length === 0) {
    console.log('   (no allocation records for the affected employees)\n');
  } else {
    console.table(snapshotRows);
  }
  const staleCount = snapshotRows.filter((r) => r.desync !== 'ok').length;
  console.log(
    staleCount > 0
      ? `→ ${staleCount} record(s) have a stale snapshot (STALE-NULL/STALE-DIFF). ` +
          `Theory 2 CONFIRMED: these drop to "Unassigned" in the Master Overview.\n`
      : '→ No snapshot desync found for these employees. Both theories negative — dig deeper.\n',
  );

  // ── Reporting-period reproduction: affected vs their manager's other reports ─
  console.log(`── What the Master Overview renders for ${MONTH} ${YEAR} (affected + control) ──`);
  const managerIds = Array.from(
    new Set(affectedUsers.map((u) => u.managerId).filter((x): x is string => !!x)),
  );
  const cohort = await prisma.user.findMany({
    where: { managerId: { in: managerIds } },
    include: {
      manager: true,
      allocations: { where: { month: MONTH, year: YEAR }, include: { manager: true } },
    },
    orderBy: [{ firstName: 'asc' }],
  });
  console.table(
    cohort.map((u) => {
      const rec = u.allocations[0]; // unique per (employee, month, year)
      return {
        employee: fullName(u),
        hasRecord: !!rec,
        status: rec ? rec.status : 'Not Submitted',
        masterOverviewGroup: rec
          ? fullName(rec.manager) || '(Unassigned bucket)'
          : fullName(u.manager) || '(Unassigned bucket)', // no record → falls back to live FK
        employeeMgmtGroup: fullName(u.manager) || '(none)',
        desync: rec ? classify(rec.managerId, u.managerId) : 'n/a (no record)',
      };
    }),
  );

  // ── Blast radius: every desynced record org-wide ───────────────────────────
  console.log('── Blast radius: ALL allocation records whose snapshot ≠ live managerId ──');
  const allRecords = await prisma.allocationRecord.findMany({
    include: {
      employee: { select: { email: true, firstName: true, lastName: true, managerId: true } },
    },
  });
  const desynced = allRecords.filter(
    (r) => r.managerId !== r.employee.managerId,
  );
  if (desynced.length === 0) {
    console.log('   ✅ None — every record\'s snapshot matches the live FK.\n');
  } else {
    const byPeriod = new Map<string, { staleNull: number; staleDiff: number; emails: Set<string> }>();
    for (const r of desynced) {
      const key = `${r.year} ${r.month}`;
      const g = byPeriod.get(key) ?? { staleNull: 0, staleDiff: 0, emails: new Set<string>() };
      if (r.managerId === null && r.employee.managerId !== null) g.staleNull += 1;
      else g.staleDiff += 1;
      g.emails.add(r.employee.email);
      byPeriod.set(key, g);
    }
    console.table(
      Array.from(byPeriod.entries()).map(([period, g]) => ({
        period,
        'STALE-NULL': g.staleNull,
        'STALE-DIFF': g.staleDiff,
        employees: Array.from(g.emails).sort().join(', '),
      })),
    );
    console.log(
      `   ⚠️  ${desynced.length} record(s) across ${byPeriod.size} period(s) are desynced. ` +
        `(No changes made — read-only.)\n`,
    );
  }

  console.log('(Read-only — no changes made.)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
