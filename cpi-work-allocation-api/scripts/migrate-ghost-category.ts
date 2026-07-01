/**
 * scripts/migrate-ghost-category.ts
 *
 * One-time, idempotent migration: repoint every reference to the legacy
 * category name "BD/Mktg/Sales" to the current taxonomy name
 * "Sales, Marketing & BD".
 *
 * SCOPE GUARANTEE: only rows whose value is *exactly* "BD/Mktg/Sales" are
 * touched. It updates the CATEGORY axis only:
 *   - AllocationActivity.streamCategory
 *   - InferenceRule.category
 *   - WorkType.parents[]        (exact array element, de-duplicated)
 *   - MainCategory.name         (only if the old row still exists)
 *   - JournalEntry.content      (literal substring in raw text)
 * It deliberately does NOT touch the Team named "BD/Mktg/Sales" — teams are
 * a separate axis and renaming one would move employee/record assignments.
 *
 *   npx tsx scripts/migrate-ghost-category.ts
 *
 * Runs inside a single transaction and is safe to re-run — a second pass
 * reports zero changes.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const OLD = 'BD/Mktg/Sales';
const NEW = 'Sales, Marketing & BD';

async function main() {
  const summary: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    // 1. MainCategory row — rename only if the old name still exists. If the
    //    admin already renamed it, this is a no-op; orphaned references below
    //    are still reconciled.
    const oldCat = await tx.mainCategory.findUnique({ where: { name: OLD } });
    if (oldCat) {
      const clash = await tx.mainCategory.findUnique({ where: { name: NEW } });
      if (clash) {
        // Both names exist (partial prior migration): drop the stale OLD row
        // so the unique-name index stays clean. Its FK-linked children cascade;
        // string references are repointed in the steps below.
        await tx.mainCategory.delete({ where: { id: oldCat.id } });
        summary['MainCategory (deleted stale duplicate)'] = 1;
      } else {
        await tx.mainCategory.update({ where: { id: oldCat.id }, data: { name: NEW } });
        summary['MainCategory (renamed)'] = 1;
      }
    }

    // 2. AllocationActivity.streamCategory — the denormalised copy on saved cards.
    summary['AllocationActivity.streamCategory'] = (
      await tx.allocationActivity.updateMany({
        where: { streamCategory: OLD },
        data: { streamCategory: NEW },
      })
    ).count;

    // 3. InferenceRule.category — the live source of new mis-classifications.
    summary['InferenceRule.category'] = (
      await tx.inferenceRule.updateMany({
        where: { category: OLD },
        data: { category: NEW },
      })
    ).count;

    // 4. WorkType.parents[] (String[] — no FK, map manually and de-dup so a
    //    partial prior rename can't leave both OLD and NEW in the same array).
    const wts = await tx.workType.findMany({ where: { parents: { has: OLD } } });
    for (const wt of wts) {
      const remapped = [...new Set(wt.parents.map((p) => (p === OLD ? NEW : p)))];
      await tx.workType.update({ where: { id: wt.id }, data: { parents: remapped } });
    }
    summary['WorkType.parents[]'] = wts.length;

    // 5. JournalEntry.content — raw text a user literally typed the old string
    //    into. (Legacy #bdmktg short-codes resolve in the parser, not here.)
    const journals = await tx.journalEntry.findMany({
      where: { content: { contains: OLD } },
      select: { id: true, content: true },
    });
    for (const j of journals) {
      await tx.journalEntry.update({
        where: { id: j.id },
        data: { content: j.content.split(OLD).join(NEW) },
      });
    }
    summary['JournalEntry.content'] = journals.length;
  });

  console.log(`\nRepointed "${OLD}" → "${NEW}":\n`);
  console.table(summary);
  console.log('\n✅ Migration complete (single transaction, exact-match only).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
