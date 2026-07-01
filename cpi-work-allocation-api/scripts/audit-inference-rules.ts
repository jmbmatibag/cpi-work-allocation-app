/**
 * scripts/audit-inference-rules.ts
 *
 * READ-ONLY, comprehensive audit of every InferenceRule against the live
 * taxonomy. Performs ZERO writes — safe to run against production anytime.
 *
 *   npx tsx scripts/audit-inference-rules.ts
 *   npx tsx scripts/audit-inference-rules.ts --verbose   # print every flagged rule
 *
 * Why this is broader than cleanup-orphaned-rules.ts:
 * cleanup only checks whether a name EXISTS anywhere in the taxonomy. But the
 * Inference Rules editor renders each dropdown SCOPED to the hierarchy, so a
 * rule can show a BLANK dropdown even when its stored value exists globally.
 * This audit replicates the editor's exact scoping (see ClientsConfigContext):
 *
 *   subCategoriesForMain(main) = subs whose parentMainCategory === main
 *   workTypesForParent(parent) = work types whose parents[] includes parent
 *   activeParent = category-has-subs ? rule.subCategory : rule.category
 *   → the Work Type dropdown lists workTypesForParent(activeParent)
 *
 * A rule's Work Type is BLANK in the UI whenever its workType is not in that
 * scoped list — which happens for several distinct reasons, each reported
 * separately below so you can see the full picture, not just missing names.
 *
 * Nothing here is auto-fixed: the correct remedy (re-parent the work type,
 * re-map the rule's category/sub, or delete the rule) is a human decision.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const VERBOSE = process.argv.includes('--verbose');
const norm = (s: string) => s.trim().toLowerCase();

interface Flag {
  id: number;
  category: string;
  subCategory: string | null;
  workType: string;
  issues: string[];
}

async function main() {
  const [mainCats, subCats, workTypes, rules] = await Promise.all([
    prisma.mainCategory.findMany({ select: { name: true } }),
    prisma.subCategory.findMany({ include: { mainCategory: { select: { name: true } } } }),
    prisma.workType.findMany({ select: { name: true, parents: true } }),
    prisma.inferenceRule.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  const mainNames = new Set(mainCats.map((m) => norm(m.name)));
  // sub name (norm) → set of parent-main names (norm) it lives under
  const subToMains = new Map<string, Set<string>>();
  for (const s of subCats) {
    const key = norm(s.name);
    if (!subToMains.has(key)) subToMains.set(key, new Set());
    subToMains.get(key)!.add(norm(s.mainCategory.name));
  }
  // main name (norm) → does it have any sub-categories?
  const mainHasSubs = new Set<string>();
  for (const s of subCats) mainHasSubs.add(norm(s.mainCategory.name));
  // work type name (norm) → set of parent names (norm) it is attached to
  const workTypeParents = new Map<string, Set<string>>();
  for (const w of workTypes) workTypeParents.set(norm(w.name), new Set(w.parents.map(norm)));

  // Bucket counters — one rule can land in several.
  const buckets: Record<string, Flag[]> = {
    'category missing (deleted/renamed)': [],
    'sub-category missing (deleted)': [],
    'sub-category not under its category': [],
    'missing sub-category (category requires one)': [],
    'work type empty': [],
    'work type missing (deleted)': [],
    'work type hidden (pick a sub-category first)': [],
    'work type not parented under its category/sub (renders BLANK)': [],
    'no keywords (rule can never match)': [],
  };

  const flagged: Flag[] = [];

  for (const rule of rules) {
    const issues: string[] = [];
    const catN = norm(rule.category);
    const catExists = mainNames.has(catN);

    if (!catExists) {
      issues.push('category missing (deleted/renamed)');
    }

    // Sub-category checks.
    if (rule.subCategory != null && rule.subCategory !== '') {
      const subN = norm(rule.subCategory);
      const mainsForSub = subToMains.get(subN);
      if (!mainsForSub) {
        issues.push('sub-category missing (deleted)');
      } else if (catExists && !mainsForSub.has(catN)) {
        issues.push('sub-category not under its category');
      }
    } else if (catExists && mainHasSubs.has(catN)) {
      // Category has sub-categories but this rule pins none → the editor
      // shows "Pick sub first" and the Work Type dropdown is empty.
      issues.push('missing sub-category (category requires one)');
    }

    // Determine the active parent exactly as the editor does.
    const hasSubs = catExists && mainHasSubs.has(catN);
    const activeParent =
      hasSubs
        ? rule.subCategory && rule.subCategory !== ''
          ? norm(rule.subCategory)
          : null
        : catExists
          ? catN
          : null;

    // Work type checks.
    if (!rule.workType || rule.workType === '') {
      issues.push('work type empty');
    } else {
      const wtN = norm(rule.workType);
      const parentsOfWt = workTypeParents.get(wtN);
      if (!parentsOfWt) {
        issues.push('work type missing (deleted)');
      } else if (activeParent === null) {
        // Exists, but there is no valid parent to scope it under, so the
        // dropdown can't show it. Only report if not already covered by a
        // category/sub issue above (it always is, but keep the signal clear).
        if (hasSubs && (!rule.subCategory || rule.subCategory === '')) {
          issues.push('work type hidden (pick a sub-category first)');
        }
      } else if (!parentsOfWt.has(activeParent)) {
        issues.push('work type not parented under its category/sub (renders BLANK)');
      }
    }

    if (rule.keywords.length === 0) {
      issues.push('no keywords (rule can never match)');
    }

    if (issues.length > 0) {
      const flag: Flag = {
        id: rule.id,
        category: rule.category,
        subCategory: rule.subCategory,
        workType: rule.workType || '(empty)',
        issues,
      };
      flagged.push(flag);
      for (const iss of issues) buckets[iss].push(flag);
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────
  console.log(
    `\nRead-only audit of ${rules.length} inference rule(s) against taxonomy: ` +
      `${mainCats.length} categories, ${subCats.length} sub-categories, ${workTypes.length} work types.\n`,
  );

  const summary = Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([issue, list]) => ({ issue, rules: list.length }));

  if (summary.length === 0) {
    console.log('✅ Every rule resolves cleanly against the taxonomy — no issues found.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${flagged.length} rule(s) with at least one issue. Breakdown by type:\n`);
  console.table(summary);

  // Per-bucket detail (id + fields) so you can see exactly which rules.
  for (const [issue, list] of Object.entries(buckets)) {
    if (list.length === 0) continue;
    console.log(`\n▸ ${issue} — ${list.length} rule(s):`);
    const rows = (VERBOSE ? list : list.slice(0, 25)).map((f) => ({
      id: f.id,
      category: f.category,
      subCategory: f.subCategory ?? '(none)',
      workType: f.workType,
    }));
    console.table(rows);
    if (!VERBOSE && list.length > 25) {
      console.log(`   … ${list.length - 25} more. Re-run with --verbose to list all.`);
    }
  }

  console.log(
    '\nNo changes were made (read-only). ' +
      'The "renders BLANK" and "not under its category/sub" rows are the ones that show empty dropdowns. ' +
      'Fix by re-parenting the work type in the taxonomy, or re-mapping the rule in the Inference Rules editor.',
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
