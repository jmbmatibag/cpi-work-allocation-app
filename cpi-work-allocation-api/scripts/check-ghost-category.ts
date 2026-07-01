/**
 * scripts/check-ghost-category.ts
 *
 * READ-ONLY audit. Counts how many live rows still carry the legacy
 * category name "BD/Mktg/Sales" across every place the string is stored.
 * Performs ZERO writes — safe to run against production at any time.
 *
 *   npx tsx scripts/check-ghost-category.ts
 *
 * Uses the app's own prisma singleton so the datasource/connection config
 * matches the running server exactly.
 */

import { prisma } from '../src/lib/prisma.js';

const OLD = 'BD/Mktg/Sales';

async function main() {
  const [
    allocationActivities,
    inferenceRules,
    mainCategory,
    journalEntries,
    workTypes,
  ] = await Promise.all([
    // The allocation cards — the denormalised copy that renames don't reach.
    prisma.allocationActivity.count({ where: { streamCategory: OLD } }),
    // Inference rules — you reported these are already fixed; verifying.
    prisma.inferenceRule.count({ where: { category: OLD } }),
    // The taxonomy row itself.
    prisma.mainCategory.count({ where: { name: OLD } }),
    // Raw journal text that literally contains the old string.
    prisma.journalEntry.count({ where: { content: { contains: OLD } } }),
    // WorkType.parents is a String[] — count rows where the array still has it.
    prisma.workType.count({ where: { parents: { has: OLD } } }),
  ]);

  const rows = {
    'AllocationActivity.streamCategory (allocation cards)': allocationActivities,
    'InferenceRule.category': inferenceRules,
    'MainCategory.name (taxonomy row)': mainCategory,
    'WorkType.parents[]': workTypes,
    'JournalEntry.content (raw text)': journalEntries,
  };

  console.log(`\nRows still holding "${OLD}":\n`);
  console.table(rows);

  const total = Object.values(rows).reduce((a, b) => a + b, 0);
  console.log(
    total === 0
      ? '\n✅ Clean — no live rows reference the old name. Nothing to migrate.'
      : `\n⚠️  ${total} row(s) still reference the old name. (No changes made — this was read-only.)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
