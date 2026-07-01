/**
 * scripts/cleanup-orphaned-rules.ts
 *
 * Epic 1 — one-time cleanup of orphaned InferenceRule references.
 *
 * Over time, rules accumulate references to taxonomy names that were later
 * renamed or deleted. The Inference Rules editor then renders BLANK dropdowns
 * for Sub Category / Work Type because the stored value has no matching option.
 * This script sanitizes those rules so the user can re-map them cleanly.
 *
 * What it checks, per rule, against the live taxonomy:
 *   - category      → must be an existing MainCategory name
 *   - subCategory   → (when non-null) must be an existing SubCategory name
 *   - workType      → must be an existing WorkType name
 *
 * What it does to orphaned fields:
 *   - orphaned subCategory → reset to null (and clear subCategoryId FK)
 *   - orphaned workType    → reset to "" (workType is NOT NULL in the schema;
 *                            "" is exactly what the editor treats as
 *                            "unselected") and clear workTypeId FK
 *   - orphaned category    → REPORTED ONLY. category is NOT NULL with no
 *                            sensible default, and the editor already surfaces
 *                            an orphaned category as a selectable option so the
 *                            row still renders. These need a human decision
 *                            (re-map or delete), so we never guess here.
 *
 * Existence checks are case-insensitive so a rule that merely differs in case
 * from the canonical taxonomy name (e.g. "geniisys" vs "Geniisys") is NOT
 * treated as orphaned.
 *
 * SAFETY: dry-run by default — prints exactly what WOULD change and writes
 * nothing. Pass --apply to commit the changes inside a single transaction.
 *
 *   npx tsx scripts/cleanup-orphaned-rules.ts            # preview (no writes)
 *   npx tsx scripts/cleanup-orphaned-rules.ts --apply    # perform the cleanup
 *
 * Idempotent: running it again after --apply reports nothing to fix.
 * Uses the app's own prisma singleton so the datasource matches the server.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const APPLY = process.argv.includes('--apply');

interface PlannedChange {
  id: number;
  keywords: string;
  category: string;
  /** Human-readable summary of the reset(s) applied to this rule. */
  changes: string[];
  data: {
    subCategory?: null;
    subCategoryId?: null;
    workType?: string;
    workTypeId?: null;
  };
}

async function main() {
  // 1. Fetch the up-to-date taxonomy and build case-insensitive name sets.
  const [mainCats, subCats, workTypes, rules] = await Promise.all([
    prisma.mainCategory.findMany({ select: { name: true } }),
    prisma.subCategory.findMany({ select: { name: true } }),
    prisma.workType.findMany({ select: { name: true } }),
    prisma.inferenceRule.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  const norm = (s: string) => s.trim().toLowerCase();
  const mainNames = new Set(mainCats.map((m) => norm(m.name)));
  const subNames = new Set(subCats.map((s) => norm(s.name)));
  const workTypeNames = new Set(workTypes.map((w) => norm(w.name)));

  // 2. Evaluate every rule.
  const planned: PlannedChange[] = [];
  const orphanedCategories: Array<{ id: number; category: string; workType: string }> = [];

  for (const rule of rules) {
    const changes: string[] = [];
    const data: PlannedChange['data'] = {};

    // Sub category orphaned? (only meaningful when the rule targets one)
    if (rule.subCategory != null && !subNames.has(norm(rule.subCategory))) {
      changes.push(`subCategory "${rule.subCategory}" → null`);
      data.subCategory = null;
      data.subCategoryId = null;
    }

    // Work type orphaned? (workType is required — reset to "" = "unselected")
    if (!workTypeNames.has(norm(rule.workType))) {
      changes.push(`workType "${rule.workType || '(empty)'}" → (cleared)`);
      data.workType = '';
      data.workTypeId = null;
    }

    if (changes.length > 0) {
      planned.push({
        id: rule.id,
        keywords: rule.keywords.join(', '),
        category: rule.category,
        changes,
        data,
      });
    }

    // Category orphaned → report only (cannot be nulled; needs a human).
    if (!mainNames.has(norm(rule.category))) {
      orphanedCategories.push({ id: rule.id, category: rule.category, workType: rule.workType });
    }
  }

  // 3. Report.
  console.log(
    `\nScanned ${rules.length} inference rule(s) against taxonomy: ` +
      `${mainCats.length} categories, ${subCats.length} sub-categories, ${workTypes.length} work types.\n`,
  );

  if (planned.length === 0) {
    console.log('✅ No orphaned Sub Category / Work Type references found — nothing to reset.');
  } else {
    console.log(`Found ${planned.length} rule(s) with orphaned Sub Category / Work Type references:\n`);
    for (const p of planned) {
      console.log(`  Rule #${p.id}  [${p.category}]  keywords: ${p.keywords || '(none)'}`);
      for (const c of p.changes) console.log(`      • ${c}`);
    }
  }

  if (orphanedCategories.length > 0) {
    console.log(
      `\n⚠️  ${orphanedCategories.length} rule(s) point to a category that does not exist in THIS ` +
        `database's taxonomy. These are NOT auto-changed — category is required, has no default, and the ` +
        `correct target can't be inferred safely. Re-map or delete them in the Inference Rules editor:`,
    );
    console.table(orphanedCategories);
  }

  // 4. Apply (only with --apply).
  if (planned.length === 0) {
    await prisma.$disconnect();
    return;
  }

  if (!APPLY) {
    console.log('\n(DRY RUN — no changes written. Re-run with --apply to commit the resets above.)');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const p of planned) {
      await tx.inferenceRule.update({ where: { id: p.id }, data: p.data });
    }
  });

  console.log(
    `\n✅ Applied. Reset fields on ${planned.length} rule(s). ` +
      `The blank Sub Category / Work Type dropdowns now show as unselected — re-map them in the editor.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
