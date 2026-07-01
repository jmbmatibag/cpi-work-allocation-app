/**
 * scripts/diagnose-inference.ts
 *
 * READ-ONLY diagnostic. For a given sub-category (default "Geniisys"), shows:
 *   1. its parent main category
 *   2. the work types the editor would list under it (parents[] includes it)
 *   3. every inference rule the parser would CONSIDER for a "#<sub>" tag
 *      (category = parent main, scoped to this sub or main-level), with keywords
 *   4. per work type: whether a considered rule can actually produce it, and if
 *      so which keywords — i.e. exactly why a work type resolves or stays blank
 *
 * Performs ZERO writes — safe on production.
 *
 *   npx tsx scripts/diagnose-inference.ts                 # defaults to Geniisys
 *   npx tsx scripts/diagnose-inference.ts "Quick Policy"  # any sub-category
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const norm = (s: string) => s.trim().toLowerCase();
const SUB = process.argv[2] || 'Geniisys';

async function main() {
  const sub = await prisma.subCategory.findFirst({
    where: { name: { equals: SUB, mode: 'insensitive' } },
    include: { mainCategory: { select: { name: true } } },
  });

  if (!sub) {
    console.log(`Sub-category "${SUB}" not found. Existing sub-categories:`);
    const all = await prisma.subCategory.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    console.log(all.map((s) => s.name).join(', '));
    await prisma.$disconnect();
    return;
  }

  const mainName = sub.mainCategory.name;
  console.log(`\nSub-category: "${sub.name}"   parent main category: "${mainName}"\n`);

  // (2) Work types the dropdown lists under this sub.
  const wtsUnderSub = await prisma.workType.findMany({
    where: { parents: { has: sub.name } },
    select: { name: true, parents: true },
    orderBy: { name: 'asc' },
  });
  console.log(`Work types selectable under "${sub.name}" (${wtsUnderSub.length}):`);
  console.log('  ' + (wtsUnderSub.map((w) => w.name).join(', ') || '(none)'));

  // (3) Rules the parser would consider for "#<sub>": category = parent main,
  // AND (main-level rule OR scoped to this sub). Mirrors scopeRulesToCategory.
  const catRules = await prisma.inferenceRule.findMany({
    where: { category: { equals: mainName, mode: 'insensitive' } },
    orderBy: { sortOrder: 'asc' },
  });
  const considered = catRules.filter(
    (r) => !r.subCategory || norm(r.subCategory) === norm(sub.name),
  );
  console.log(`\nInference rules the parser CONSIDERS for "#${sub.name}" (category="${mainName}", main-level or sub="${sub.name}"): ${considered.length}\n`);
  console.table(
    considered.slice(0, 60).map((r) => ({
      id: r.id,
      workType: r.workType,
      subCategory: r.subCategory ?? '(main-level)',
      keywords: r.keywords.join(', '),
    })),
  );
  if (considered.length > 60) console.log(`  … ${considered.length - 60} more not shown.`);

  // (4) Per selectable work type: is there a considered rule producing it?
  const producible = new Map<string, string[][]>();
  for (const r of considered) {
    const key = norm(r.workType);
    if (!producible.has(key)) producible.set(key, []);
    producible.get(key)!.push(r.keywords);
  }
  console.log(`\nCan the parser SET each work type under "${sub.name}"? (needs a considered rule whose keywords appear in the text)\n`);
  console.table(
    wtsUnderSub.map((w) => {
      const kwSets = producible.get(norm(w.name));
      return {
        workType: w.name,
        hasConsideredRule: kwSets ? 'YES' : 'NO — will always be BLANK',
        exampleKeywords: kwSets ? kwSets.map((k) => `[${k.join(', ')}]`).join(' ; ') : '—',
      };
    }),
  );

  // Also flag rules that produce these work types but are scoped OUT (wrong
  // category) — the likely reason Meetings/etc. fail.
  const wtNames = wtsUnderSub.map((w) => norm(w.name));
  const elsewhere = await prisma.inferenceRule.findMany({
    where: { workType: { in: wtsUnderSub.map((w) => w.name) } },
  });
  const scopedOut = elsewhere.filter(
    (r) => norm(r.category) !== norm(mainName) && wtNames.includes(norm(r.workType)),
  );
  if (scopedOut.length > 0) {
    console.log(
      `\n⚠️  ${scopedOut.length} rule(s) produce a work type valid under "${sub.name}" but are stored under a DIFFERENT category, so scoping to "${mainName}" DROPS them (this is likely why those work types stay blank):`,
    );
    console.table(
      scopedOut.slice(0, 40).map((r) => ({
        id: r.id,
        workType: r.workType,
        storedCategory: r.category,
        subCategory: r.subCategory ?? '(main-level)',
        keywords: r.keywords.join(', '),
      })),
    );
  }

  console.log('\n(Read-only — no changes made.)');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
