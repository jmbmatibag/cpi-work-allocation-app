/**
 * scripts/diagnose-inference.ts
 *
 * READ-ONLY diagnostic. For a given sub-category (default "Geniisys"), shows —
 * using the SAME scoping the fixed parser uses — which work types the parser
 * can actually set from a "#<sub>" tag, and which will stay blank because no
 * rule carries a usable (non-structural) keyword for them.
 *
 * The fixed parser scopes candidate rules by WORK-TYPE VALIDITY under the
 * parent (workTypesByParent), NOT by the rule's stored category, and ignores
 * "structural" keywords when scoring: the parent/main/sub names AND client
 * codes (they appear in every auto-generated rule and carry no work-type
 * signal). This script mirrors that so its verdict matches production.
 *
 * Performs ZERO writes — safe on production.
 *
 *   npx tsx scripts/diagnose-inference.ts                 # defaults to Geniisys
 *   npx tsx scripts/diagnose-inference.ts "Quick Policy"  # any sub-category
 *   npx tsx scripts/diagnose-inference.ts --all           # scan EVERY sub-category
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const norm = (s: string) => s.trim().toLowerCase();
const ALL = process.argv.includes('--all');
const SUB_ARG = process.argv.slice(2).find((a) => !a.startsWith('--'));

async function main() {
  // Shared reference data (fetched once).
  const [mains, allSubs, workTypes, clients, rules] = await Promise.all([
    prisma.mainCategory.findMany({ select: { name: true } }),
    prisma.subCategory.findMany({ include: { mainCategory: { select: { name: true } } } }),
    prisma.workType.findMany({ select: { name: true, parents: true } }),
    prisma.client.findMany({ select: { name: true } }),
    prisma.inferenceRule.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  // Structural keywords the parser ignores when scoring a work type: every
  // main + sub name and every client code. (The specific parent name is added
  // per sub below, but including all taxonomy names is a safe superset.)
  const structural = new Set<string>([
    ...mains.map((m) => norm(m.name)),
    ...allSubs.map((s) => norm(s.name)),
    ...clients.map((c) => norm(c.name)),
  ]);

  const subsToScan = ALL
    ? allSubs
    : allSubs.filter((s) => norm(s.name) === norm(SUB_ARG || 'Geniisys'));

  if (subsToScan.length === 0) {
    console.log(`Sub-category "${SUB_ARG}" not found. Existing sub-categories:`);
    console.log(allSubs.map((s) => s.name).join(', '));
    await prisma.$disconnect();
    return;
  }

  const gaps: Array<{ subCategory: string; workType: string }> = [];

  for (const sub of subsToScan) {
    const mainName = sub.mainCategory.name;

    // (2) Work types selectable under this sub (what the dropdown lists).
    const wtsUnderSub = workTypes
      .filter((w) => w.parents.includes(sub.name))
      .map((w) => w.name);
    const validSet = new Set(wtsUnderSub.map(norm));

    // Candidate rules per the FIXED parser: workType is valid under this sub,
    // regardless of the rule's stored category.
    const candidates = rules.filter((r) => validSet.has(norm(r.workType)));

    // A work type is reachable if some candidate rule for it has ≥1 keyword
    // that is NOT structural (not a parent/sub name or client code) — that's a
    // keyword a user could actually type to select it.
    const reachable = new Map<string, string[]>();
    for (const r of candidates) {
      const usable = r.keywords.filter((k) => !structural.has(norm(k)));
      if (usable.length === 0) continue;
      const key = norm(r.workType);
      if (!reachable.has(key)) reachable.set(key, []);
      for (const k of usable) if (!reachable.get(key)!.includes(k)) reachable.get(key)!.push(k);
    }

    console.log(`\n════ Sub-category "${sub.name}"  (main: "${mainName}") ════`);
    console.log(`Selectable work types (${wtsUnderSub.length}): ${wtsUnderSub.join(', ') || '(none)'}`);
    console.table(
      wtsUnderSub.map((w) => {
        const kws = reachable.get(norm(w));
        if (!kws) gaps.push({ subCategory: sub.name, workType: w });
        return {
          workType: w,
          canBeDetected: kws ? 'YES' : 'NO — no usable keyword, will stay BLANK',
          usableKeywords: kws ? kws.slice(0, 12).join(', ') + (kws.length > 12 ? ' …' : '') : '—',
        };
      }),
    );
  }

  if (gaps.length > 0) {
    console.log(
      `\n⚠️  ${gaps.length} (sub-category, work type) pair(s) have NO usable keyword rule — ` +
        `the parser can never auto-select them; users must pick manually. Add a keyword rule ` +
        `(or re-run rule generation) to close these:`,
    );
    console.table(gaps.slice(0, 100));
    if (gaps.length > 100) console.log(`   … ${gaps.length - 100} more.`);
  } else {
    console.log('\n✅ Every selectable work type has at least one usable keyword rule.');
  }

  console.log('\n(Read-only — no changes made.)');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
