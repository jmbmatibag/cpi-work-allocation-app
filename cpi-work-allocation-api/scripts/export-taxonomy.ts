/**
 * scripts/export-taxonomy.ts
 *
 * READ-ONLY export of the complete taxonomy picture + everything that depends
 * on it. Performs ZERO writes — safe to run against production at any time.
 *
 *   npx tsx scripts/export-taxonomy.ts
 *   npx tsx scripts/export-taxonomy.ts --out /tmp/taxonomy-prod.json
 *
 * Purpose: planning the "flatten Projects" change Finance asked for (every
 * SubCategory under `Projects` gets promoted to a MainCategory). Before writing
 * a migration we need to know, from LIVE data:
 *
 *   1. the exact taxonomy tree (names, sortOrder, clients[] per sub-category)
 *   2. which WorkTypes point at sub-category names vs main-category names,
 *      since WorkType.parents is a name-based String[] with no FK
 *   3. how many InferenceRules carry `category: "Projects"` + a subCategory
 *   4. the blast radius in denormalised copies — AllocationActivity rows store
 *      streamCategory/subCategory as plain strings that renames never reach
 *   5. NAME COLLISIONS — MainCategory.name is @unique, so any sub-category
 *      whose name already exists as a main category blocks the promotion
 *
 * Prints a human summary to stdout and writes the full JSON to --out.
 *
 * Uses the app's own prisma singleton so the datasource/connection config
 * matches the running server exactly.
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
  const outPath = argValue('--out') ?? 'taxonomy-export.json';

  const [mainCategories, subCategories, workTypes, inferenceRules, clients, teams] =
    await Promise.all([
      prisma.mainCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.subCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.workType.findMany({ orderBy: { name: 'asc' } }),
      prisma.inferenceRule.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.client.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.team.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);

  const mainById = new Map(mainCategories.map((m) => [m.id, m]));
  const mainNames = new Set(mainCategories.map((m) => m.name));
  const target = mainCategories.find((m) => m.name === TARGET);
  const targetSubs = target ? subCategories.filter((s) => s.mainCategoryId === target.id) : [];
  const targetSubNames = new Set(targetSubs.map((s) => s.name));

  // ── Denormalised copies: the cards employees already submitted ─────────────
  const activityByCategory = await prisma.allocationActivity.groupBy({
    by: ['streamCategory'],
    _count: { _all: true },
  });
  const activityByTargetSub = await prisma.allocationActivity.groupBy({
    by: ['streamCategory', 'subCategory'],
    where: { streamCategory: TARGET },
    _count: { _all: true },
  });
  // Rows that name a target sub-category but sit under some OTHER category —
  // these are the ones a naive migration would silently miss.
  const strayActivities = await prisma.allocationActivity.groupBy({
    by: ['streamCategory', 'subCategory'],
    where: { subCategory: { in: [...targetSubNames] }, streamCategory: { not: TARGET } },
    _count: { _all: true },
  });

  // ── WorkType.parents is name-based; classify every parent reference ────────
  const workTypeAnalysis = workTypes.map((wt) => ({
    id: wt.id,
    name: wt.name,
    parents: wt.parents,
    parentsUnderTarget: wt.parents.filter((p) => targetSubNames.has(p)),
    parentIsTargetItself: wt.parents.includes(TARGET),
    parentsOtherMainCategories: wt.parents.filter((p) => mainNames.has(p) && p !== TARGET),
    // A parent name matching nothing in the taxonomy = already-broken pointer.
    danglingParents: wt.parents.filter(
      (p) => !mainNames.has(p) && !subCategories.some((s) => s.name === p),
    ),
  }));

  // ── Collisions that would break the promotion (MainCategory.name @unique) ──
  const nameCollisions = targetSubs
    .filter((s) => mainNames.has(s.name))
    .map((s) => ({ subCategory: s.name, collidesWithMainCategory: s.name }));
  const teamNameOverlap = targetSubs
    .filter((s) => teams.some((t) => t.name === s.name))
    .map((s) => s.name);

  // ── Inference rules keyed on the target ───────────────────────────────────
  const targetRules = inferenceRules.filter((r) => r.category === TARGET);
  const rulesWithoutFk = targetRules.filter((r) => r.subCategoryId === null);
  const rulesNamingTargetSubsElsewhere = inferenceRules.filter(
    (r) => r.category !== TARGET && r.subCategory && targetSubNames.has(r.subCategory),
  );

  // ── Raw journal text still tagging the target category ────────────────────
  const journalMentions = await prisma.journalEntry.count({
    where: { content: { contains: TARGET, mode: 'insensitive' } },
  });

  const report = {
    exportedAt: new Date().toISOString(),
    databaseHost: (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***:***@'),
    targetCategory: TARGET,

    counts: {
      mainCategories: mainCategories.length,
      subCategories: subCategories.length,
      workTypes: workTypes.length,
      inferenceRules: inferenceRules.length,
      clients: clients.length,
      teams: teams.length,
      subCategoriesUnderTarget: targetSubs.length,
      inferenceRulesUnderTarget: targetRules.length,
      journalEntriesMentioningTarget: journalMentions,
    },

    // The full tree, exactly as the Outline tab renders it.
    tree: mainCategories.map((m) => ({
      id: m.id,
      name: m.name,
      sortOrder: m.sortOrder,
      subCategories: subCategories
        .filter((s) => s.mainCategoryId === m.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          clients: s.clients,
          workTypes: workTypes.filter((wt) => wt.parents.includes(s.name)).map((wt) => wt.name),
          inferenceRuleCount: inferenceRules.filter((r) => r.subCategory === s.name).length,
        })),
      // Work types attached directly to the main category (no sub-category hop).
      directWorkTypes: workTypes.filter((wt) => wt.parents.includes(m.name)).map((wt) => wt.name),
    })),

    orphanedSubCategories: subCategories
      .filter((s) => !mainById.has(s.mainCategoryId))
      .map((s) => ({ id: s.id, name: s.name, mainCategoryId: s.mainCategoryId })),

    migrationBlockers: {
      nameCollisions,
      teamNameOverlap,
      workTypesWithDanglingParents: workTypeAnalysis
        .filter((w) => w.danglingParents.length > 0)
        .map((w) => ({ name: w.name, danglingParents: w.danglingParents })),
      workTypesSharedAcrossCategories: workTypeAnalysis
        .filter((w) => w.parentsUnderTarget.length > 0 && w.parentsOtherMainCategories.length > 0)
        .map((w) => ({
          name: w.name,
          underTarget: w.parentsUnderTarget,
          alsoUnder: w.parentsOtherMainCategories,
        })),
      inferenceRulesUnderTargetWithoutFk: rulesWithoutFk.length,
      inferenceRulesNamingTargetSubsUnderAnotherCategory: rulesNamingTargetSubsElsewhere.map((r) => ({
        id: r.id,
        category: r.category,
        subCategory: r.subCategory,
        workType: r.workType,
      })),
      strayAllocationActivities: strayActivities.map((a) => ({
        streamCategory: a.streamCategory,
        subCategory: a.subCategory,
        count: a._count._all,
      })),
    },

    submittedDataImpact: {
      byCategory: activityByCategory
        .map((a) => ({ streamCategory: a.streamCategory, activities: a._count._all }))
        .sort((x, y) => y.activities - x.activities),
      targetBySubCategory: activityByTargetSub
        .map((a) => ({ subCategory: a.subCategory, activities: a._count._all }))
        .sort((x, y) => y.activities - x.activities),
    },

    // Raw rows — everything needed to reproduce the tree offline.
    raw: { mainCategories, subCategories, workTypes: workTypeAnalysis, inferenceRules, clients, teams },
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  // ── Human summary ─────────────────────────────────────────────────────────
  console.log(`\n=== Taxonomy export — target category: "${TARGET}" ===\n`);
  console.table(report.counts);

  console.log(`\nTree shape:`);
  for (const m of report.tree) {
    const wtCount = new Set([
      ...m.directWorkTypes,
      ...m.subCategories.flatMap((s) => s.workTypes),
    ]).size;
    console.log(
      `  ${m.name}  —  ${m.subCategories.length} sub cats · ${wtCount} work types` +
        (m.directWorkTypes.length ? ` (${m.directWorkTypes.length} attached directly)` : ''),
    );
  }

  if (targetSubs.length) {
    console.log(`\nSub-categories that would be promoted to Main Category:`);
    for (const s of report.tree.find((m) => m.name === TARGET)?.subCategories ?? []) {
      console.log(
        `  - ${s.name}  (${s.workTypes.length} work types, ${s.clients.length} clients, ${s.inferenceRuleCount} rules)`,
      );
    }
  } else {
    console.log(`\n⚠️  No main category named "${TARGET}" found — check the name.`);
  }

  const blockers = report.migrationBlockers;
  const blockerTotal =
    blockers.nameCollisions.length +
    blockers.workTypesWithDanglingParents.length +
    blockers.workTypesSharedAcrossCategories.length +
    blockers.inferenceRulesNamingTargetSubsUnderAnotherCategory.length +
    blockers.strayAllocationActivities.length +
    report.orphanedSubCategories.length;

  console.log(
    blockerTotal === 0
      ? `\n✅ No migration blockers detected.`
      : `\n⚠️  ${blockerTotal} item(s) need a decision before migrating — see "migrationBlockers" in the JSON.`,
  );

  console.log(`\nWrote full JSON → ${outPath}  (read-only; no changes made)\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
