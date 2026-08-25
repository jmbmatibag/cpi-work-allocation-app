/**
 * scripts/flatten-projects.ts
 *
 * Elevates every SubCategory under "Projects" to its own MainCategory,
 * nullifies the middle tier, and removes "Projects".
 *
 *   npx tsx scripts/flatten-projects.ts              # DRY RUN (rehearse + roll back)
 *   npx tsx scripts/flatten-projects.ts --apply      # COMMIT
 *   npx tsx scripts/flatten-projects.ts --orphan-work-types attach-all
 *
 * SAFETY MODEL
 * ------------
 * A dry run is not a simulation. It executes every write inside a real
 * $transaction, runs the post-condition asserts against the mutated state,
 * then throws a sentinel to force a rollback. If the dry run reports OK,
 * --apply does the identical work and commits.
 *
 * ORDERING IS LOAD-BEARING. InferenceRule.subCategoryId is `onDelete:
 * Cascade`, so rules MUST be re-pointed off the SubCategory rows BEFORE those
 * rows are deleted, or Postgres silently deletes them with no error.
 *
 * Activities are updated IN PLACE by id — never delete+recreate — so
 * flagReason / flaggedAt survive (see the July flag-persistence regression,
 * where an autosave delete+recreate wiped per-card flags).
 *
 * Run scripts/diagnose-projects-flatten.ts first: it is read-only and sizes
 * the card split this script performs.
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

const TARGET = process.env.TAXONOMY_TARGET ?? 'Projects';
const APPLY = process.argv.includes('--apply');
const ROLLBACK = Symbol('dry-run-rollback');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Destination for work types whose ONLY parent is "Projects" itself. */
const ORPHAN_MODE = argValue('--orphan-work-types'); // 'attach-all' | '<CategoryName>'

type Change = { kind: string; detail: string };

async function main(): Promise<void> {
  const changes: Change[] = [];
  const note = (kind: string, detail: string): void => {
    changes.push({ kind, detail });
    console.log(`  ${kind.padEnd(24)} ${detail}`);
  };

  console.log(`\n=== Flatten "${TARGET}" — ${APPLY ? 'APPLY' : 'DRY RUN'} ===\n`);

  try {
    await prisma.$transaction(
      async (tx) => {
        // ── 0. Load + preflight ──────────────────────────────────────────
        const target = await tx.mainCategory.findUnique({
          where: { name: TARGET },
          include: {
            subCategories: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
          },
        });
        if (!target) throw new Error(`No MainCategory named "${TARGET}" — nothing to do.`);
        if (target.subCategories.length === 0) {
          throw new Error(`"${TARGET}" has no sub-categories — already flat?`);
        }

        const subs = target.subCategories;
        const subNames = subs.map((s) => s.name);
        const subByName = new Map(subs.map((s) => [s.name, s]));

        // MainCategory.name is @unique — a collision would fail mid-transaction.
        const collisions = await tx.mainCategory.findMany({
          where: { name: { in: subNames } },
          select: { name: true },
        });
        if (collisions.length) {
          throw new Error(
            `ABORT — MainCategory already exists with these names: ` +
              collisions.map((c) => c.name).join(', '),
          );
        }

        // Activities under TARGET with no sub-category have nowhere to go.
        const homeless = await tx.allocationActivity.count({
          where: { streamCategory: TARGET, OR: [{ subCategory: null }, { subCategory: '' }] },
        });
        if (homeless > 0) {
          throw new Error(
            `ABORT — ${homeless} activity row(s) are streamCategory="${TARGET}" with no ` +
              `subCategory. There is no category to promote them into. Resolve them ` +
              `manually (see diagnose-projects-flatten.ts) before migrating.`,
          );
        }

        // Sub-category values on activities that aren't in the taxonomy.
        const stray = await tx.allocationActivity.findMany({
          where: { streamCategory: TARGET, subCategory: { notIn: subNames } },
          select: { subCategory: true },
          distinct: ['subCategory'],
        });
        if (stray.length) {
          throw new Error(
            `ABORT — activities reference sub-categories not in the taxonomy: ` +
              stray.map((s) => s.subCategory).join(', '),
          );
        }

        // Work types whose ONLY parent is TARGET would be left with an empty
        // parents[], violating the .min(1) invariant in
        // SetWorkTypeParentsSchema — the settings UI could no longer save them.
        const orphanWorkTypes = (
          await tx.workType.findMany({ where: { parents: { has: TARGET } } })
        ).filter((wt) => wt.parents.every((p) => p === TARGET));
        if (orphanWorkTypes.length > 0 && !ORPHAN_MODE) {
          throw new Error(
            `ABORT — ${orphanWorkTypes.length} work type(s) have "${TARGET}" as their ONLY ` +
              `parent and would be orphaned:\n    ` +
              orphanWorkTypes.map((w) => w.name).join(', ') +
              `\n  Re-run with --orphan-work-types attach-all   (attach to every promoted category)` +
              `\n  or         --orphan-work-types "<CategoryName>"  (attach to one).` +
              `\n  Deliberately NOT guessed — a wrong parent silently mis-scopes inference.`,
          );
        }
        if (ORPHAN_MODE && ORPHAN_MODE !== 'attach-all' && !subByName.has(ORPHAN_MODE)) {
          throw new Error(
            `ABORT — --orphan-work-types "${ORPHAN_MODE}" is not one of the promoted ` +
              `categories: ${subNames.join(', ')}`,
          );
        }

        // Baselines for the post-condition asserts.
        const beforeActivityCount = await tx.allocationActivity.count();
        const beforePctByRecord = await recordPercentageMap(tx);
        const beforeRuleCount = await tx.inferenceRule.count();

        console.log(`Preflight OK — ${subs.length} sub-categories to promote.\n`);

        // ── 1. Create the new Main Categories ────────────────────────────
        const maxSort =
          (await tx.mainCategory.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;

        const newMainByName = new Map<string, number>();
        for (const [i, sub] of subs.entries()) {
          const created = await tx.mainCategory.create({
            data: {
              name: sub.name,
              // Promoted categories land after the existing mains, keeping
              // their relative order from the old sub-category list.
              sortOrder: maxSort + 1 + i,
              // Roster carries over verbatim — this is what keeps the
              // Scenario A/E client fan-out alive post-flatten.
              clients: sub.clients,
            },
          });
          newMainByName.set(sub.name, created.id);
          note('created-main', `${sub.name} (clients: ${sub.clients.length})`);
        }

        // ── 2. Re-point InferenceRules — BEFORE any delete ───────────────
        // While subCategoryId still points at a row we're about to delete,
        // each rule is one DELETE away from vanishing via Cascade.
        const rules = await tx.inferenceRule.findMany({
          where: {
            OR: [
              { category: TARGET },
              { subCategoryId: { in: subs.map((s) => s.id) } },
              { subCategory: { in: subNames } },
            ],
          },
        });

        let repointed = 0;
        const triage: number[] = [];
        for (const rule of rules) {
          const destName =
            rule.subCategory && subByName.has(rule.subCategory) ? rule.subCategory : null;

          if (!destName) {
            // category === TARGET with no resolvable sub. No destination — do
            // NOT guess one; a wrong rule silently mis-classifies every future
            // journal entry that trips its keywords.
            triage.push(rule.id);
            continue;
          }

          await tx.inferenceRule.update({
            where: { id: rule.id },
            data: {
              category: destName, // "Projects" -> "Geniisys"
              subCategory: null, // middle tier nullified
              subCategoryId: null, // detach from the doomed FK
              mainCategoryId: newMainByName.get(destName)!, // re-anchor cascade
            },
          });
          repointed++;
        }
        note('rules-repointed', `${repointed} of ${rules.length} scanned`);
        if (triage.length) {
          note(
            'rules-need-triage',
            `${triage.length} left on "${TARGET}" with no sub — ids: ${triage.join(', ')}`,
          );
        }

        // ── 3. Re-stream activities (THE CARD SPLIT) ─────────────────────
        // A single "Projects" card can hold several projects. Post-flatten
        // they no longer share a category, so the card must SPLIT — one per
        // project — or every non-first activity is mislabelled with the first
        // activity's project name (toFrontendRecord takes the card category
        // from activities[0]).
        const recordIds = (
          await tx.allocationActivity.findMany({
            where: { streamCategory: TARGET },
            select: { recordId: true },
            distinct: ['recordId'],
          })
        ).map((r) => r.recordId);

        const acts = await tx.allocationActivity.findMany({
          where: { recordId: { in: recordIds } },
          orderBy: [{ recordId: 'asc' }, { streamOrder: 'asc' }, { activityOrder: 'asc' }],
        });

        type Act = (typeof acts)[number];
        const byRecord = new Map<string, Act[]>();
        for (const a of acts) {
          const list = byRecord.get(a.recordId);
          if (list) list.push(a);
          else byRecord.set(a.recordId, [a]);
        }

        let splitCards = 0;
        let touched = 0;

        for (const [, list] of byRecord) {
          // Bucket in first-appearance order. Non-target streams keep their
          // slot; a target stream expands IN PLACE into N consecutive streams,
          // so the surrounding cards keep their relative position.
          type Bucket = { promoted: string | null; items: Act[] };
          const buckets: Bucket[] = [];
          const seen = new Map<string, number>();

          for (const a of list) {
            const promoted = a.streamCategory === TARGET ? a.subCategory : null;
            const key = `${a.streamOrder}::${promoted ?? '__keep__'}`;
            let idx = seen.get(key);
            if (idx === undefined) {
              idx = buckets.length;
              seen.set(key, idx);
              buckets.push({ promoted, items: [] });
            }
            buckets[idx].items.push(a);
          }

          const originalStreams = new Set(list.map((a) => a.streamOrder)).size;
          if (buckets.length > originalStreams) splitCards += buckets.length - originalStreams;

          for (let si = 0; si < buckets.length; si++) {
            const b = buckets[si];
            for (let ai = 0; ai < b.items.length; ai++) {
              const a = b.items[ai];
              const nextCategory = b.promoted ?? a.streamCategory;
              const nextSub = b.promoted ? null : a.subCategory;

              // Skip no-op writes so the updatedAt churn stays honest.
              if (
                a.streamOrder === si &&
                a.activityOrder === ai &&
                a.streamCategory === nextCategory &&
                a.subCategory === nextSub
              ) {
                continue;
              }

              // UPDATE by id — never delete+recreate. flagReason / flaggedAt
              // live on this row and must survive.
              await tx.allocationActivity.update({
                where: { id: a.id },
                data: {
                  streamOrder: si,
                  activityOrder: ai,
                  streamCategory: nextCategory,
                  subCategory: nextSub,
                },
              });
              touched++;
            }
          }
        }
        note('activities-restreamed', `${touched} rows across ${byRecord.size} records`);
        note('net-new-cards', `+${splitCards}`);

        // ── 4. Work type parents ─────────────────────────────────────────
        // Promoted categories keep the SAME NAME as the old sub-category, so
        // parents[] entries naming a sub stay valid for free. Only the literal
        // "Projects" entry has to be pruned.
        const wtWithTarget = await tx.workType.findMany({ where: { parents: { has: TARGET } } });
        for (const wt of wtWithTarget) {
          let next = wt.parents.filter((p) => p !== TARGET);
          if (next.length === 0) {
            next = ORPHAN_MODE === 'attach-all' ? [...subNames] : [ORPHAN_MODE!];
          }
          await tx.workType.update({ where: { id: wt.id }, data: { parents: next } });
        }
        note('worktypes-repointed', `${wtWithTarget.length}`);

        // ── 5. Tear down the old tier ────────────────────────────────────
        // Safe only now: no InferenceRule still points at these rows, so the
        // Cascade has nothing left to take with it.
        const delSubs = await tx.subCategory.deleteMany({ where: { mainCategoryId: target.id } });
        note('subcategories-deleted', `${delSubs.count}`);

        await tx.mainCategory.delete({ where: { id: target.id } });
        note('main-deleted', TARGET);

        // ── 6. Post-conditions — assert, don't hope ──────────────────────
        const afterActivityCount = await tx.allocationActivity.count();
        if (afterActivityCount !== beforeActivityCount) {
          throw new Error(
            `POST-CONDITION FAILED — activity count changed ` +
              `${beforeActivityCount} -> ${afterActivityCount}. Rolling back.`,
          );
        }

        const afterPctByRecord = await recordPercentageMap(tx);
        for (const [recordId, before] of beforePctByRecord) {
          const after = afterPctByRecord.get(recordId) ?? 0;
          if (Math.abs(before - after) > 0.01) {
            throw new Error(
              `POST-CONDITION FAILED — record ${recordId} percentage total ` +
                `${before} -> ${after}. Rolling back.`,
            );
          }
        }

        const afterRuleCount = await tx.inferenceRule.count();
        if (afterRuleCount !== beforeRuleCount) {
          throw new Error(
            `POST-CONDITION FAILED — inference rule count changed ` +
              `${beforeRuleCount} -> ${afterRuleCount}. A Cascade fired. Rolling back.`,
          );
        }

        const leftoverActs = await tx.allocationActivity.count({
          where: { streamCategory: TARGET },
        });
        const leftoverRules = await tx.inferenceRule.count({ where: { category: TARGET } });
        if (leftoverActs || leftoverRules) {
          throw new Error(
            `POST-CONDITION FAILED — ${leftoverActs} activities and ${leftoverRules} rules ` +
              `still reference "${TARGET}". Rolling back.`,
          );
        }

        const emptyParents = await tx.workType.count({ where: { parents: { isEmpty: true } } });
        if (emptyParents) {
          throw new Error(
            `POST-CONDITION FAILED — ${emptyParents} work type(s) have no parents, violating ` +
              `the .min(1) invariant in SetWorkTypeParentsSchema. Rolling back.`,
          );
        }

        console.log(`\nAll post-conditions passed.`);

        if (!APPLY) throw ROLLBACK;

        await tx.auditLog.create({
          data: {
            userId: null,
            action: 'flatten-taxonomy',
            entity: 'MainCategory',
            entityId: String(target.id),
            payload: {
              removed: TARGET,
              promoted: subNames,
              activitiesRestreamed: touched,
              netNewCards: splitCards,
              rulesRepointed: repointed,
              rulesNeedingTriage: triage,
            },
          },
        });
      },
      // 1k+ activity updates is well past the 5s default.
      { timeout: 180_000, maxWait: 15_000 },
    );

    console.log(`\nCOMMITTED — "${TARGET}" is flattened.\n`);
  } catch (e) {
    if (e === ROLLBACK) {
      console.log(
        `\nDRY RUN complete — transaction rolled back, database unchanged.` +
          `\n  Re-run with --apply to commit.\n`,
      );
      writeFileSync('./flatten-plan.json', JSON.stringify(changes, null, 2), 'utf8');
      console.log(`  Wrote ./flatten-plan.json\n`);
      return;
    }
    console.error(`\nABORTED — database unchanged.\n`);
    throw e;
  }
}

/** recordId -> summed activity percentage. Used as a conservation check. */
async function recordPercentageMap(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<Map<string, number>> {
  const rows = await tx.allocationActivity.groupBy({
    by: ['recordId'],
    _sum: { percentage: true },
  });
  return new Map(rows.map((r) => [r.recordId, parseFloat((r._sum.percentage ?? 0).toFixed(2))]));
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
