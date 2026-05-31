/**
 * prisma/seed.ts — idempotent demo data for local development.
 *
 * Run with:  npm run db:seed
 * Or:        npx prisma db seed
 *
 * Safe to run multiple times — everything is upserted.
 * The seed mirrors the frontend SEED_EMPLOYEES / SEED_* constants so
 * the API-mode app starts with the exact same demo state as the
 * localStorage-mode app.
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  TEAMS,
  CLIENTS,
  MAIN_CATEGORIES,
  SUB_CATEGORIES,
  WORK_TYPES,
  INFERENCE_RULES,
} from './seed-data.js';

const prisma = new PrismaClient();

// ── Employees ─────────────────────────────────────────────────────────────────
// Mirrors EmployeesContext SEED_EMPLOYEES. Passwords are plain text here
// only because this is demo seed data — real users authenticate via OTP.

// Multi-role assignments:
//   - jbmatibag (MGR001, IT Director): Admin + Manager + Employee.
//     Manager is required because seven users below have managerId=MGR001
//     — dropping the Manager role would invalidate those assignments.
//     Employee is included so he can also submit his own timesheet.
//   - HEAD001 (Roberto Cruz, IT Department Head): Admin + Manager + Employee.
//     Boss-level user; carries all three operational hats. ("IT Department
//     Head" is a job title, not a role — the "Head" role was retired and
//     its access folded into the Admin scope.)
//   - FIN001 (Patricia Lim): Finance + Employee.
//   - EMP003 (Maria Santos): Manager + Employee. She has no reports yet
//     but is configured to receive some via the UI.
//   - Everyone else: single Employee role.
const EMPLOYEES = [
  // Employees under Carlos Reyes (MGR001)
  { id: 'EMP001', firstName: 'Jose',     lastName: 'Escobar',   email: 'jose@cpi.com.ph',     password: 'pass123',    roles: ['Employee'] as const,                       team: 'IT/Platforms',      managerId: 'MGR001', jobTitle: 'Software Engineer'       },
  { id: 'EMP004', firstName: 'Carlos',   lastName: 'Garcia',    email: 'carlos@cpi.com.ph',   password: 'pass123',    roles: ['Employee'] as const,                       team: 'IT/Platforms',      managerId: 'MGR001', jobTitle: 'Security Engineer'       },
  { id: 'EMP011', firstName: 'Kim',      lastName: 'Ramos',     email: 'kim@cpi.com.ph',      password: 'pass123',    roles: ['Employee'] as const,                       team: 'IT/Platforms',      managerId: 'MGR001', jobTitle: 'IT Support'              },
  { id: 'EMP005', firstName: 'Ana',      lastName: 'Reyes',     email: 'ana@cpi.com.ph',      password: 'pass123',    roles: ['Employee'] as const,                       team: 'IT/Platforms',      managerId: 'MGR001', jobTitle: 'DevOps Engineer'         },
  { id: 'EMP006', firstName: 'Rico',     lastName: 'Mendoza',   email: 'rico@cpi.com.ph',     password: 'pass123',    roles: ['Employee'] as const,                       team: 'Ancillary Solutions', managerId: 'MGR001', jobTitle: 'Geniisys Developer'   },
  { id: 'EMP007', firstName: 'Paolo',    lastName: 'Cruz',      email: 'paolo@cpi.com.ph',    password: 'pass123',    roles: ['Employee'] as const,                       team: 'Ancillary Solutions', managerId: 'MGR001', jobTitle: 'Geniisys QA Engineer' },
  { id: 'EMP002', firstName: 'Juan',     lastName: 'Dela Cruz', email: 'jd@cpi.com.ph',       password: 'pass123',    roles: ['Employee'] as const,                       team: 'HR',                managerId: 'MGR001', jobTitle: 'HR Specialist'           },
  // Manager / Finance / Admin — no managerId (top of chain)
  { id: 'EMP003',  firstName: 'Maria',    lastName: 'Santos', email: 'maria@cpi.com.ph',     password: 'pass123',    roles: ['Manager', 'Employee'] as const,          team: 'Ancillary Solutions', managerId: null, jobTitle: 'Project Manager'    },
  { id: 'MGR001',  firstName: 'Carlos',   lastName: 'Reyes',  email: 'jbmatibag@cpi.com.ph', password: 'admin123',   roles: ['Admin', 'Manager', 'Employee'] as const, team: 'IT/Platforms',      managerId: null, jobTitle: 'IT Director'        },
  { id: 'FIN001',  firstName: 'Patricia', lastName: 'Lim',    email: 'finance@cpi.com.ph',   password: 'finance123', roles: ['Finance', 'Employee'] as const,          team: 'Finance',            managerId: null, jobTitle: 'Finance Controller' },
  { id: 'HEAD001', firstName: 'Roberto',  lastName: 'Cruz',   email: 'head@cpi.com.ph',      password: 'head123',    roles: ['Admin', 'Manager', 'Employee'] as const, team: 'IT/Platforms',      managerId: null, jobTitle: 'IT Department Head' },
];

// Config / taxonomy constants (TEAMS, CLIENTS, MAIN_CATEGORIES, SUB_CATEGORIES,
// WORK_TYPES, INFERENCE_RULES) live in ./seed-data.ts so the production
// scripts/seed-config.ts can reuse them without dragging in EMPLOYEES.

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database…');

  // 1. Employees — two passes: first seed managers/top-of-chain, then reports,
  //    so the FK from employee.managerId → user.id is always satisfied.
  const topOfChain = EMPLOYEES.filter((e) => e.managerId === null);
  const withManager = EMPLOYEES.filter((e) => e.managerId !== null);

  for (const emp of [...topOfChain, ...withManager]) {
    const passwordHash = await bcrypt.hash(emp.password, 10);
    // `set` semantics on array columns: replace the whole array each run.
    // Without `set`, Prisma would try to append — the seed wouldn't be
    // idempotent across re-runs after a role change.
    const rolesPayload = [...emp.roles];
    await prisma.user.upsert({
      where: { id: emp.id },
      create: {
        id:           emp.id,
        firstName:    emp.firstName,
        lastName:     emp.lastName,
        email:        emp.email,
        passwordHash,
        roles:        rolesPayload,
        team:         emp.team,
        managerId:    emp.managerId ?? null,
        jobTitle:     emp.jobTitle,
      },
      update: {
        firstName:    emp.firstName,
        lastName:     emp.lastName,
        email:        emp.email,
        roles:        { set: rolesPayload },
        team:         emp.team,
        managerId:    emp.managerId ?? null,
        jobTitle:     emp.jobTitle,
        // Do NOT overwrite passwordHash on update — keeps OTP-set passwords.
      },
    });
    console.log(`  ✓ User ${emp.id} (${emp.email}) [${rolesPayload.join(', ')}]`);
  }

  // 2. Teams
  for (let i = 0; i < TEAMS.length; i++) {
    await prisma.team.upsert({
      where: { name: TEAMS[i] },
      create: { name: TEAMS[i], sortOrder: i },
      update: { sortOrder: i },
    });
  }
  console.log(`  ✓ ${TEAMS.length} teams`);

  // 3. Clients
  for (let i = 0; i < CLIENTS.length; i++) {
    await prisma.client.upsert({
      where: { name: CLIENTS[i] },
      create: { name: CLIENTS[i], sortOrder: i },
      update: { sortOrder: i },
    });
  }
  console.log(`  ✓ ${CLIENTS.length} clients`);

  // 4. Main categories
  for (let i = 0; i < MAIN_CATEGORIES.length; i++) {
    await prisma.mainCategory.upsert({
      where: { name: MAIN_CATEGORIES[i] },
      create: { name: MAIN_CATEGORIES[i], sortOrder: i },
      update: { sortOrder: i },
    });
  }
  console.log(`  ✓ ${MAIN_CATEGORIES.length} main categories`);

  // 5. Sub categories — require parent to exist first (seeded above)
  for (let i = 0; i < SUB_CATEGORIES.length; i++) {
    const sub = SUB_CATEGORIES[i];
    const parent = await prisma.mainCategory.findUniqueOrThrow({
      where: { name: sub.parentMainCategory },
    });
    await prisma.subCategory.upsert({
      where: { name: sub.name },
      create: {
        name:          sub.name,
        mainCategoryId: parent.id,
        clients:       sub.clients,
        sortOrder:     i,
      },
      update: {
        mainCategoryId: parent.id,
        clients:        sub.clients,
        sortOrder:      i,
      },
    });
  }
  console.log(`  ✓ ${SUB_CATEGORIES.length} sub categories`);

  // 6. Work types
  for (const wt of WORK_TYPES) {
    await prisma.workType.upsert({
      where: { name: wt.name },
      create: { name: wt.name, parents: wt.parents },
      update: { parents: wt.parents },
    });
  }
  console.log(`  ✓ ${WORK_TYPES.length} work types`);

  // 7. Inference rules — bulk replace so order is always correct.
  await prisma.inferenceRule.deleteMany();
  for (let i = 0; i < INFERENCE_RULES.length; i++) {
    const rule = INFERENCE_RULES[i];
    await prisma.inferenceRule.create({
      data: {
        keywords:    rule.keywords,
        category:    rule.category,
        subCategory: 'subCategory' in rule ? rule.subCategory ?? null : null,
        workType:    rule.workType,
        sortOrder:   i,
      },
    });
  }
  console.log(`  ✓ ${INFERENCE_RULES.length} inference rules`);

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
