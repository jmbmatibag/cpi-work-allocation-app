/**
 * scripts/seed-config.ts — production config seeder.
 *
 * Idempotent: seeds ONLY the taxonomy / config tables (Team, Client,
 * MainCategory, SubCategory, WorkType, InferenceRule). No users, no
 * transactional data. Safe to re-run on a populated DB — every row uses
 * upsert keyed on the unique `name` column.
 *
 * Pairs with scripts/reset-db.ts in the production deploy flow:
 *
 *   1. npx prisma migrate deploy        ← schema
 *   2. npx tsx scripts/seed-config.ts   ← config only (this file)
 *   3. npx tsx scripts/reset-db.ts      ← master admin only
 *
 * Run with:  npx tsx scripts/seed-config.ts
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  TEAMS,
  CLIENTS,
  MAIN_CATEGORIES,
  SUB_CATEGORIES,
  WORK_TYPES,
  INFERENCE_RULES,
} from '../prisma/seed-data.js';

const prisma = new PrismaClient();

async function main() {
  console.log('=== CPI Work Allocation — Config Seed ===');
  console.log(`DATABASE_URL host: ${new URL(process.env.DATABASE_URL ?? 'postgres://unset').host}`);
  console.log('');

  // Teams
  for (let i = 0; i < TEAMS.length; i++) {
    await prisma.team.upsert({
      where: { name: TEAMS[i] },
      create: { name: TEAMS[i], sortOrder: i },
      update: { sortOrder: i },
    });
  }
  console.log(`  - Team           ${TEAMS.length}`);

  // Clients
  for (let i = 0; i < CLIENTS.length; i++) {
    await prisma.client.upsert({
      where: { name: CLIENTS[i] },
      create: { name: CLIENTS[i], sortOrder: i },
      update: { sortOrder: i },
    });
  }
  console.log(`  - Client         ${CLIENTS.length}`);

  // Main categories
  for (let i = 0; i < MAIN_CATEGORIES.length; i++) {
    await prisma.mainCategory.upsert({
      where: { name: MAIN_CATEGORIES[i] },
      create: { name: MAIN_CATEGORIES[i], sortOrder: i },
      update: { sortOrder: i },
    });
  }
  console.log(`  - MainCategory   ${MAIN_CATEGORIES.length}`);

  // Sub categories — must come after main categories (FK on mainCategoryId)
  for (let i = 0; i < SUB_CATEGORIES.length; i++) {
    const sub = SUB_CATEGORIES[i];
    const parent = await prisma.mainCategory.findUniqueOrThrow({
      where: { name: sub.parentMainCategory },
    });
    await prisma.subCategory.upsert({
      where: { name: sub.name },
      create: {
        name: sub.name,
        mainCategoryId: parent.id,
        clients: sub.clients,
        sortOrder: i,
      },
      update: {
        mainCategoryId: parent.id,
        clients: sub.clients,
        sortOrder: i,
      },
    });
  }
  console.log(`  - SubCategory    ${SUB_CATEGORIES.length}`);

  // Work types
  for (const wt of WORK_TYPES) {
    await prisma.workType.upsert({
      where: { name: wt.name },
      create: { name: wt.name, parents: wt.parents },
      update: { parents: wt.parents },
    });
  }
  console.log(`  - WorkType       ${WORK_TYPES.length}`);

  // Inference rules — bulk-replace so sortOrder is always coherent.
  // Safe because inference rules are a derived lookup table; no FKs point at them.
  await prisma.inferenceRule.deleteMany();
  for (let i = 0; i < INFERENCE_RULES.length; i++) {
    const rule = INFERENCE_RULES[i];
    await prisma.inferenceRule.create({
      data: {
        keywords: rule.keywords,
        category: rule.category,
        subCategory: 'subCategory' in rule ? rule.subCategory ?? null : null,
        workType: rule.workType,
        sortOrder: i,
      },
    });
  }
  console.log(`  - InferenceRule  ${INFERENCE_RULES.length}`);

  console.log('');
  console.log('Config seed complete.');
}

main()
  .catch((err) => {
    console.error('');
    console.error('Config seed FAILED.');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
