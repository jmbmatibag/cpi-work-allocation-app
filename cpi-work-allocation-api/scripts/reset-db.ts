/**
 * scripts/reset-db.ts — production-prep database reset.
 *
 * What it does:
 *   1. Wipes ALL transactional / user data (AuditLog, OtpCode, RefreshToken,
 *      JournalEntry, AllocationActivity, AllocationRecord, User).
 *   2. Preserves ALL configuration tables (Team, Client, MainCategory,
 *      SubCategory, WorkType, InferenceRule).
 *   3. Creates a single master admin user (jbmatibag@cpi.com.ph / admin123!)
 *      and assigns every UserRole enum value to that account.
 *
 * The wipe + seed run inside a single interactive Prisma transaction, so if
 * seeding throws, the deletes are rolled back and the database is left in
 * its original state.
 *
 * Run with:
 *   npx tsx scripts/reset-db.ts
 *
 * (from the cpi-work-allocation-api directory).
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient();

const ADMIN = {
  id: 'ADM001',
  firstName: 'Jun Mark',
  lastName: 'Matibag',
  email: 'jbmatibag@cpi.com.ph',
  team: 'IT/Platforms',
  jobTitle: 'System Administrator',
  password: 'admin123!',
} as const;

async function main() {
  console.log('=== CPI Work Allocation — Database Reset ===');
  console.log(`DATABASE_URL host: ${new URL(process.env.DATABASE_URL ?? 'postgres://unset').host}`);
  console.log('');

  await prisma.$transaction(
    async (tx) => {
      // ── Phase 1: Wipe transactional data ─────────────────────────────────
      // FK ordering: every child row must be gone before its parent.
      //   AuditLog        → User (SetNull, safe to leave but we wipe history)
      //   OtpCode         → User (Cascade)
      //   RefreshToken    → User (Cascade)
      //   JournalEntry    → User (Cascade)
      //   AllocationActivity → AllocationRecord (Cascade)
      //   AllocationRecord   → User (no cascade — must delete before User)
      //   User            → root of the user graph
      //
      // Cascades would handle some of these implicitly, but we delete each
      // table explicitly so the row counts surface in the log output.
      console.log('Phase 1: Wiping transactional data');

      const auditLogs = await tx.auditLog.deleteMany({});
      console.log(`  - AuditLog            ${auditLogs.count}`);

      const otpCodes = await tx.otpCode.deleteMany({});
      console.log(`  - OtpCode             ${otpCodes.count}`);

      const refreshTokens = await tx.refreshToken.deleteMany({});
      console.log(`  - RefreshToken        ${refreshTokens.count}`);

      const journalEntries = await tx.journalEntry.deleteMany({});
      console.log(`  - JournalEntry        ${journalEntries.count}`);

      const activities = await tx.allocationActivity.deleteMany({});
      console.log(`  - AllocationActivity  ${activities.count}`);

      const allocations = await tx.allocationRecord.deleteMany({});
      console.log(`  - AllocationRecord    ${allocations.count}`);

      const users = await tx.user.deleteMany({});
      console.log(`  - User                ${users.count}`);

      console.log('');

      // ── Phase 2: Seed master admin ───────────────────────────────────────
      console.log('Phase 2: Seeding master admin');

      const passwordHash = await bcrypt.hash(ADMIN.password, 10);
      const allRoles = Object.values(UserRole) as UserRole[];

      const admin = await tx.user.create({
        data: {
          id: ADMIN.id,
          firstName: ADMIN.firstName,
          lastName: ADMIN.lastName,
          email: ADMIN.email,
          passwordHash,
          roles: allRoles,
          team: ADMIN.team,
          managerId: null,
          jobTitle: ADMIN.jobTitle,
        },
      });

      console.log(`  - Created ${admin.id} <${admin.email}>`);
      console.log(`    roles: ${admin.roles.join(', ')}`);
    },
    {
      // Wipes on a populated DB can easily exceed the 5 s default.
      maxWait: 10_000,
      timeout: 60_000,
    },
  );

  console.log('');
  console.log('Phase 3: Verifying config tables were preserved');
  const [teams, clients, mains, subs, workTypes, rules] = await Promise.all([
    prisma.team.count(),
    prisma.client.count(),
    prisma.mainCategory.count(),
    prisma.subCategory.count(),
    prisma.workType.count(),
    prisma.inferenceRule.count(),
  ]);
  console.log(`  - Team           ${teams}`);
  console.log(`  - Client         ${clients}`);
  console.log(`  - MainCategory   ${mains}`);
  console.log(`  - SubCategory    ${subs}`);
  console.log(`  - WorkType       ${workTypes}`);
  console.log(`  - InferenceRule  ${rules}`);

  console.log('');
  console.log('Reset complete.');
  console.log(`Login with: ${ADMIN.email} / ${ADMIN.password}`);
}

main()
  .catch((err) => {
    console.error('');
    console.error('Reset FAILED — transaction rolled back, database unchanged.');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
