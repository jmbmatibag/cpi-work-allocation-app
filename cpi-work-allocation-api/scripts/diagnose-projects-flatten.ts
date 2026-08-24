/**
 * scripts/diagnose-projects-flatten.ts
 *
 * READ-ONLY impact analysis for the "flatten Projects" change. ZERO writes —
 * safe on production at any time.
 *
 *   npx tsx scripts/diagnose-projects-flatten.ts
 *   npx tsx scripts/diagnose-projects-flatten.ts --out /tmp/flatten-impact.json
 *
 * WHY THIS EXISTS
 * ---------------
 * `toFrontendRecord` (src/lib/mappers.ts) rebuilds allocation CARDS by
 * grouping activities on `streamOrder`, and takes the card's category from
 * the FIRST activity in each group:
 *
 *     streamMap.set(act.streamOrder, { category: act.streamCategory, ... })
 *
 * Today one "Projects" card legitimately holds activities for several
 * different sub-categories (Geniisys + Quick Policy + …), because the
 * sub-category lives on the ACTIVITY, not the card.
 *
 * Once each sub-category becomes its own MAIN category, those activities no
 * longer share a category — so the card MUST be split, one per project.
 * If the migration only rewrites `streamCategory` in place, every such card
 * silently adopts the first activity's project name and mislabels the rest.
 *
 * This script counts exactly how many cards are in that state, so the split
 * can be sized and verified rather than assumed.
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

const TARGET = process.env.TAXONOMY_TARGET ?? 'Projects';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const outPath = argValue('--out');

  const target = await prisma.mainCategory.findUnique({ where: { name: TARGET } });
  if (!target) {
    console.log(`⚠️  No main category named "${TARGET}". Nothing to analyse.`);
    return;
  }
  const subs = await prisma.subCategory.findMany({ where: { mainCategoryId: target.id } });
  const subNames = subs.map((s) => s.name);
  const clientsBySub = new Map(subs.map((s) => [s.name, s.clients]));

  // Every activity on a card that carries at least one TARGET activity. We need
  // the card's full contents — a "Projects" card can also hold non-Projects
  // rows, which changes how the split has to be done.
  const targetRecordIds = (
    await prisma.allocationActivity.findMany({
      where: { streamCategory: TARGET },
      select: { recordId: true },
      distinct: ['recordId'],
    })
  ).map((r) => r.recordId);

  const activities = await prisma.allocationActivity.findMany({
    where: { recordId: { in: targetRecordIds } },
    select: {
      id: true,
      recordId: true,
      streamOrder: true,
      activityOrder: true,
      streamCategory: true,
      subCategory: true,
      workType: true,
      client: true,
      percentage: true,
      record: { select: { month: true, year: true, status: true, employeeId: true } },
    },
    orderBy: [{ recordId: 'asc' }, { streamOrder: 'asc' }, { activityOrder: 'asc' }],
  });

  // ── Group into cards exactly the way toFrontendRecord does ────────────────
  type Card = {
    recordId: string;
    streamOrder: number;
    month: string;
    year: string;
    status: string;
    employeeId: string;
    categories: Set<string>;
    subCategories: Set<string>; // '(none)' for null
    activityCount: number;
    percentageTotal: number;
  };
  const cards = new Map<string, Card>();
  for (const a of activities) {
    const key = `${a.recordId}::${a.streamOrder}`;
    if (!cards.has(key)) {
      cards.set(key, {
        recordId: a.recordId,
        streamOrder: a.streamOrder,
        month: a.record.month,
        year: a.record.year,
        status: a.record.status,
        employeeId: a.record.employeeId,
        categories: new Set(),
        subCategories: new Set(),
        activityCount: 0,
        percentageTotal: 0,
      });
    }
    const c = cards.get(key)!;
    c.categories.add(a.streamCategory);
    if (a.streamCategory === TARGET) c.subCategories.add(a.subCategory ?? '(none)');
    c.activityCount += 1;
    c.percentageTotal += a.percentage;
  }

  const targetCards = [...cards.values()].filter((c) => c.categories.has(TARGET));

  // Cards that must SPLIT: more than one distinct project inside one card.
  const mustSplit = targetCards.filter((c) => c.subCategories.size > 1);
  // Cards mixing Projects with a different main category in one card.
  const mixedCategory = targetCards.filter((c) => c.categories.size > 1);
  // Cards whose Projects rows have no sub-category at all — no project to
  // promote them into. These need an explicit destination.
  const noSubCategory = targetCards.filter((c) => c.subCategories.has('(none)'));

  const splitHistogram: Record<string, number> = {};
  for (const c of targetCards) {
    const k = String(c.subCategories.size);
    splitHistogram[k] = (splitHistogram[k] ?? 0) + 1;
  }

  const cardsAfter = targetCards.reduce(
    (n, c) => n + Math.max(1, c.subCategories.size),
    0,
  );

  // ── Client validity after promotion ───────────────────────────────────────
  // An activity's client should still be listed on its (now main) category.
  const clientMismatches: Record<string, Set<string>> = {};
  for (const a of activities) {
    if (a.streamCategory !== TARGET || !a.subCategory || !a.client) continue;
    const allowed = clientsBySub.get(a.subCategory);
    if (allowed && allowed.length > 0 && !allowed.includes(a.client)) {
      (clientMismatches[a.subCategory] ??= new Set()).add(a.client);
    }
  }

  // ── Sub-category values that no longer exist in the taxonomy ─────────────
  const knownSubs = new Set(subNames);
  const unknownSubValues: Record<string, number> = {};
  for (const a of activities) {
    if (a.streamCategory !== TARGET || !a.subCategory) continue;
    if (!knownSubs.has(a.subCategory)) {
      unknownSubValues[a.subCategory] = (unknownSubValues[a.subCategory] ?? 0) + 1;
    }
  }

  const affectedRecords = new Set(targetCards.map((c) => c.recordId));
  const byStatus: Record<string, number> = {};
  for (const c of targetCards) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

  const report = {
    targetCategory: TARGET,
    summary: {
      subCategoriesUnderTarget: subs.length,
      affectedRecords: affectedRecords.size,
      cardsContainingTarget: targetCards.length,
      cardsAfterSplit: cardsAfter,
      netNewCards: cardsAfter - targetCards.length,
      cardsThatMustSplit: mustSplit.length,
      cardsMixingTargetWithAnotherCategory: mixedCategory.length,
      cardsWithTargetRowsLackingSubCategory: noSubCategory.length,
      subCategoryValuesNotInTaxonomy: Object.keys(unknownSubValues).length,
    },
    cardsPerProjectHistogram: splitHistogram,
    cardsByRecordStatus: byStatus,
    unknownSubCategoryValues: unknownSubValues,
    clientsNotOnTheirProjectRoster: Object.fromEntries(
      Object.entries(clientMismatches).map(([k, v]) => [k, [...v]]),
    ),
    // Worst offenders first — the ones to eyeball manually before applying.
    worstSplits: mustSplit
      .sort((a, b) => b.subCategories.size - a.subCategories.size)
      .slice(0, 25)
      .map((c) => ({
        recordId: c.recordId,
        period: `${c.month} ${c.year}`,
        status: c.status,
        streamOrder: c.streamOrder,
        activities: c.activityCount,
        percentageTotal: parseFloat(c.percentageTotal.toFixed(2)),
        projects: [...c.subCategories],
      })),
  };

  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n=== Flatten impact — "${TARGET}" ===\n`);
  console.table(report.summary);
  console.log(`\nProjects per card (how many cards hold N distinct projects):`);
  console.table(report.cardsPerProjectHistogram);
  console.log(`\nAffected cards by record status:`);
  console.table(report.cardsByRecordStatus);

  if (Object.keys(unknownSubValues).length) {
    console.log(`\n⚠️  subCategory values on cards that no longer exist in the taxonomy:`);
    console.table(unknownSubValues);
  }
  if (Object.keys(clientMismatches).length) {
    console.log(`\n⚠️  Clients used on a project but NOT on that project's roster:`);
    console.table(report.clientsNotOnTheirProjectRoster);
  }
  if (mustSplit.length) {
    console.log(`\nTop cards needing a split:`);
    for (const c of report.worstSplits.slice(0, 10)) {
      console.log(
        `  ${c.period}  [${c.status}]  stream #${c.streamOrder}  ` +
          `${c.activities} acts, ${c.percentageTotal}%  →  ${c.projects.length} cards: ${c.projects.join(', ')}`,
      );
    }
  }

  console.log(
    `\n${mustSplit.length === 0 ? '✅' : '⚠️ '} ${mustSplit.length} card(s) must be split into multiple cards.` +
      `  (read-only; no changes made)${outPath ? `\nWrote ${outPath}` : ''}\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
