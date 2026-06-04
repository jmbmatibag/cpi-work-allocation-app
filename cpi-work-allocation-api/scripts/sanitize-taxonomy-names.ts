/**
 * One-time sanitization script — trims leading/trailing spaces and collapses
 * interior whitespace on all taxonomy names already stored in the database.
 *
 * Run once after deploying the Epic 1 controller fix:
 *   npx tsx scripts/sanitize-taxonomy-names.ts
 *
 * The script is idempotent: running it twice produces the same result.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function sanitize(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

async function main() {
  let totalFixed = 0;

  await prisma.$transaction(async (tx) => {
    // ── MainCategory ───────────────────────────────────────────────────────
    const mainCats = await tx.mainCategory.findMany();
    for (const mc of mainCats) {
      const clean = sanitize(mc.name);
      if (clean === mc.name) continue;

      console.log(`  MainCategory #${mc.id}: "${mc.name}" → "${clean}"`);

      // 1. Rename the record itself.
      await tx.mainCategory.update({ where: { id: mc.id }, data: { name: clean } });

      // 2. Cascade: WorkType.parents (String[], no FK).
      const wtAffected = await tx.workType.findMany({ where: { parents: { has: mc.name } } });
      for (const wt of wtAffected) {
        await tx.workType.update({
          where: { id: wt.id },
          data: { parents: wt.parents.map((p) => (p === mc.name ? clean : p)) },
        });
      }

      // 3. Cascade: InferenceRule.category.
      await tx.inferenceRule.updateMany({
        where: { category: mc.name },
        data: { category: clean },
      });

      totalFixed++;
    }

    // ── SubCategory ────────────────────────────────────────────────────────
    const subCats = await tx.subCategory.findMany();
    for (const sc of subCats) {
      const clean = sanitize(sc.name);
      if (clean === sc.name) continue;

      console.log(`  SubCategory #${sc.id}: "${sc.name}" → "${clean}"`);

      await tx.subCategory.update({ where: { id: sc.id }, data: { name: clean } });

      // Cascade: WorkType.parents.
      const wtAffected = await tx.workType.findMany({ where: { parents: { has: sc.name } } });
      for (const wt of wtAffected) {
        await tx.workType.update({
          where: { id: wt.id },
          data: { parents: wt.parents.map((p) => (p === sc.name ? clean : p)) },
        });
      }

      // Cascade: InferenceRule.subCategory and keywords that embed the old name.
      const rulesAffected = await tx.inferenceRule.findMany({ where: { subCategory: sc.name } });
      for (const rule of rulesAffected) {
        await tx.inferenceRule.update({
          where: { id: rule.id },
          data: {
            subCategory: clean,
            keywords: rule.keywords.map((k) => (k === sc.name.toLowerCase() ? clean.toLowerCase() : k)),
          },
        });
      }

      totalFixed++;
    }

    // ── WorkType ───────────────────────────────────────────────────────────
    const workTypes = await tx.workType.findMany();
    for (const wt of workTypes) {
      const clean = sanitize(wt.name);
      if (clean === wt.name) continue;

      console.log(`  WorkType #${wt.id}: "${wt.name}" → "${clean}"`);

      await tx.workType.update({ where: { id: wt.id }, data: { name: clean } });

      // Cascade: InferenceRule.workType and keywords that embed the old name.
      const rulesAffected = await tx.inferenceRule.findMany({ where: { workType: wt.name } });
      for (const rule of rulesAffected) {
        await tx.inferenceRule.update({
          where: { id: rule.id },
          data: {
            workType: clean,
            keywords: rule.keywords.map((k) => (k === wt.name.toLowerCase() ? clean.toLowerCase() : k)),
          },
        });
      }

      totalFixed++;
    }
  });

  if (totalFixed === 0) {
    console.log('No dirty taxonomy names found — database is already clean.');
  } else {
    console.log(`\nDone. Fixed ${totalFixed} taxonomy name(s).`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
