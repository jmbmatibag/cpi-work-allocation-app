/**
 * scripts/diagnose-enhancement-tags.ts
 *
 * READ-ONLY sizing report for the structured Enhancement tag rollout.
 *
 * Background: `AllocationActivity.enhancementTag` is new. Every row written
 * before it existed is NULL, and the Finance export recovers those at export
 * time by parsing the description (lib/financeExport.ts -> resolveEnhancement).
 * That fallback is permanent and correct, so a backfill is OPTIONAL — its only
 * benefit is making the historical tags visible in the UI too.
 *
 * This script answers "is a backfill worth running?" before anyone runs one:
 * how many Specific Enhancement rows are untagged, how many of those the
 * parser can resolve, and which descriptions it cannot read. It writes NOTHING.
 *
 *   npx tsx scripts/diagnose-enhancement-tags.ts                 # summary
 *   npx tsx scripts/diagnose-enhancement-tags.ts --verbose       # + every unresolved row
 *   npx tsx scripts/diagnose-enhancement-tags.ts --month=July --year=2026
 *
 * Uses the app's own prisma singleton so the datasource matches the server.
 * LIVE is assumed to be ahead of LOCAL — run it against the environment you
 * actually intend to report on.
 */

import 'dotenv/config';
import { isSpecificEnhancement } from 'cpi-work-allocation-shared';
import { prisma } from '../src/lib/prisma.js';
import { extractEnhancementTag } from '../src/lib/financeExport.js';

const VERBOSE = process.argv.includes('--verbose');

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const MONTH = argValue('month');
const YEAR = argValue('year');

async function main(): Promise<void> {
  const scope = MONTH || YEAR ? { record: { ...(MONTH && { month: MONTH }), ...(YEAR && { year: YEAR }) } } : {};

  // Live roster — the report must agree with what Admin Settings shows, not
  // with a constant compiled into the build.
  const roster = (
    await prisma.enhancement.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true },
    })
  ).map((e) => e.name);

  if (roster.length === 0) {
    console.log('');
    console.log('  WARNING: the Enhancement roster is EMPTY. Nothing can be recovered');
    console.log('  by parsing until an Admin adds tags in Settings → Enhancements.');
  }

  const activities = await prisma.allocationActivity.findMany({
    where: scope,
    select: {
      id: true,
      workType: true,
      description: true,
      enhancementTag: true,
      record: { select: { employeeId: true, month: true, year: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Only Specific Enhancement rows are in scope: the export's fallback is
  // deliberately gated on work type, so a non-enhancement row whose
  // description happens to name a tag is NOT a miss.
  const enhancementRows = activities.filter((a) => isSpecificEnhancement(a.workType));

  const alreadyTagged = enhancementRows.filter((a) => a.enhancementTag?.trim());
  const untagged = enhancementRows.filter((a) => !a.enhancementTag?.trim());

  const recoverable: Array<{ id: string; tag: string }> = [];
  const unresolved: typeof untagged = [];
  for (const row of untagged) {
    const tag = extractEnhancementTag(row.description, roster);
    if (tag) recoverable.push({ id: row.id, tag });
    else unresolved.push(row);
  }

  const byTag = new Map<string, number>();
  for (const r of recoverable) byTag.set(r.tag, (byTag.get(r.tag) ?? 0) + 1);

  const period = MONTH || YEAR ? `${MONTH ?? 'all months'} ${YEAR ?? 'all years'}` : 'ALL periods';

  console.log(`\nEnhancement tag coverage — ${period}`);
  console.log('─'.repeat(62));
  console.log(`  Roster (${roster.length})${' '.repeat(26)}${roster.join(', ') || '—'}`);
  console.log(`  Activities scanned                 ${activities.length}`);
  console.log(`  Specific Enhancement rows          ${enhancementRows.length}`);
  console.log(`    ├─ already tagged (Priority 1)   ${alreadyTagged.length}`);
  console.log(`    ├─ recoverable by parse (P2)     ${recoverable.length}`);
  console.log(`    └─ blank in export               ${unresolved.length}`);

  if (byTag.size > 0) {
    console.log('\n  Parser would resolve:');
    for (const [tag, n] of [...byTag].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${tag}`);
    }
  }

  if (unresolved.length > 0) {
    console.log(
      `\n  ${unresolved.length} row(s) will export a BLANK Enhancement. That is the` +
        `\n  intended behaviour on no-match — a guessed tag would pass Finance's` +
        `\n  review unchecked. These need a human to set the tag in the UI.`,
    );
    const show = VERBOSE ? unresolved : unresolved.slice(0, 10);
    for (const r of show) {
      const desc = r.description.replace(/\s+/g, ' ').slice(0, 70);
      console.log(
        `    ${r.record.employeeId} ${r.record.month} ${r.record.year} [${r.record.status}] "${desc}"`,
      );
    }
    if (!VERBOSE && unresolved.length > show.length) {
      console.log(`    … and ${unresolved.length - show.length} more (--verbose to list all)`);
    }
  }

  console.log(
    `\n  Read-only — nothing was written. The export fallback already covers` +
      `\n  the ${recoverable.length} recoverable row(s) with no backfill at all; backfill only if` +
      `\n  you also want those tags visible in the allocation UI.\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
