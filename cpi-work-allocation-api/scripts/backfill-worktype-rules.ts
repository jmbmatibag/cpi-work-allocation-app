/**
 * scripts/backfill-worktype-rules.ts
 *
 * Aligns EXISTING data with the fixed parser. The parser detects a work type
 * only if some inference rule carries that work type's OWN keywords (parent
 * names and client codes are ignored). Historically some work types were
 * linked to a parent without a keyword-bearing rule ever being created (e.g.
 * "Meetings"/"Documentation" under a project sub-category), so they can never
 * be auto-selected and always come back blank.
 *
 * This utility ensures every work type that is a selectable option under at
 * least one parent has at least one rule containing its tokenized-name
 * keywords. It mirrors the backend's createRuleForParent generation.
 *
 * SAFETY: dry-run by default — prints what it WOULD create and writes nothing.
 * Pass --apply to create the missing rules inside one transaction. Idempotent.
 *
 *   npx tsx scripts/backfill-worktype-rules.ts            # preview
 *   npx tsx scripts/backfill-worktype-rules.ts --apply    # create missing rules
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const APPLY = process.argv.includes('--apply');
const norm = (s: string) => s.trim().toLowerCase();

// Mirror of the backend's tokenizeWorkTypeName (settings.ts) so generated
// keywords match what createWorkType/setWorkTypeParents would produce.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'by', 'for', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with',
]);
function tokenizeWorkTypeName(name: string): string[] {
  const lower = name.toLowerCase();
  const clean = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean.includes(' ')) return [clean];
  const words = clean.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set([clean, ...words])];
}

async function main() {
  const [mainCats, subCats, workTypes, rules] = await Promise.all([
    prisma.mainCategory.findMany({ select: { id: true, name: true } }),
    prisma.subCategory.findMany({ include: { mainCategory: { select: { name: true } } } }),
    prisma.workType.findMany({ select: { id: true, name: true, parents: true } }),
    prisma.inferenceRule.findMany({ select: { workType: true, keywords: true } }),
  ]);

  const mainByName = new Map(mainCats.map((m) => [norm(m.name), m]));
  const subByName = new Map(subCats.map((s) => [norm(s.name), s]));

  // For each work type, the set of token keywords already present on ANY of its
  // rules — i.e. can the parser currently detect it at all?
  const tokensPresentByWorkType = new Map<string, Set<string>>();
  for (const r of rules) {
    const key = norm(r.workType);
    if (!tokensPresentByWorkType.has(key)) tokensPresentByWorkType.set(key, new Set());
    for (const k of r.keywords) tokensPresentByWorkType.get(key)!.add(norm(k));
  }

  interface Plan {
    workType: string;
    parentName: string;
    category: string;
    subCategory: string | null;
    keywords: string[];
    subCategoryId: number | null;
    workTypeId: number;
  }
  const plans: Plan[] = [];
  const unresolved: Array<{ workType: string; parents: string }> = [];

  for (const wt of workTypes) {
    if (wt.parents.length === 0) continue; // not attached anywhere → nothing to detect under
    const tokens = tokenizeWorkTypeName(wt.name);
    const present = tokensPresentByWorkType.get(norm(wt.name)) ?? new Set<string>();
    // Already detectable if ANY of its name tokens appears on some rule for it.
    if (tokens.some((t) => present.has(t))) continue;

    // Pick a parent to scope the new rule under — prefer a sub-category parent
    // (more specific), else a main category. Resolve to real taxonomy rows.
    let chosen: Plan | null = null;
    for (const parentName of wt.parents) {
      const sub = subByName.get(norm(parentName));
      if (sub) {
        chosen = {
          workType: wt.name,
          parentName,
          category: sub.mainCategory.name,
          subCategory: sub.name,
          keywords: [...tokens, norm(parentName)],
          subCategoryId: sub.id,
          workTypeId: wt.id,
        };
        break;
      }
    }
    if (!chosen) {
      for (const parentName of wt.parents) {
        const main = mainByName.get(norm(parentName));
        if (main) {
          chosen = {
            workType: wt.name,
            parentName,
            category: main.name,
            subCategory: null,
            keywords: [...tokens, norm(parentName)],
            subCategoryId: null,
            workTypeId: wt.id,
          };
          break;
        }
      }
    }

    if (chosen) plans.push(chosen);
    else unresolved.push({ workType: wt.name, parents: wt.parents.join(', ') });
  }

  console.log(
    `\nScanned ${workTypes.length} work types against ${rules.length} rules ` +
      `(${mainCats.length} categories, ${subCats.length} sub-categories).\n`,
  );

  if (unresolved.length > 0) {
    console.log(
      `⚠️  ${unresolved.length} work type(s) have parents that don't resolve to any live ` +
        `category/sub-category (stale parents — clean up separately):`,
    );
    console.table(unresolved.slice(0, 50));
  }

  if (plans.length === 0) {
    console.log('✅ Every attached work type already has a keyword-bearing rule — nothing to backfill.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${plans.length} work type(s) with NO detectable keyword rule. Would create:`);
  console.table(
    plans.map((p) => ({
      workType: p.workType,
      scopedUnder: p.subCategory ? `${p.category} / ${p.subCategory}` : p.category,
      keywords: p.keywords.join(', '),
    })),
  );

  if (!APPLY) {
    console.log('\n(DRY RUN — no changes written. Re-run with --apply to create these rules.)');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const p of plans) {
      await tx.inferenceRule.create({
        data: {
          keywords: p.keywords,
          category: p.category,
          subCategory: p.subCategory,
          workType: p.workType,
          sortOrder: 0,
          subCategoryId: p.subCategoryId,
          workTypeId: p.workTypeId,
        },
      });
    }
  });

  console.log(`\n✅ Applied. Created ${plans.length} keyword rule(s). Re-run diagnose-inference.ts --all to confirm no gaps remain.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
