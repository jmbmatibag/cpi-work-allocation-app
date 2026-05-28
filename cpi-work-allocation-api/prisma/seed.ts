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
//     Boss-level user; carries all three operational hats. (Head role is
//     not included here; the existing Head-specific routes are merged into
//     the Admin scope. Re-add 'Head' to the array if those routes diverge.)
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
  // Manager / Head / Finance / Admin — no managerId (top of chain)
  { id: 'EMP003',  firstName: 'Maria',    lastName: 'Santos', email: 'maria@cpi.com.ph',     password: 'pass123',    roles: ['Manager', 'Employee'] as const,          team: 'Ancillary Solutions', managerId: null, jobTitle: 'Project Manager'    },
  { id: 'MGR001',  firstName: 'Carlos',   lastName: 'Reyes',  email: 'jbmatibag@cpi.com.ph', password: 'admin123',   roles: ['Admin', 'Manager', 'Employee'] as const, team: 'IT/Platforms',      managerId: null, jobTitle: 'IT Director'        },
  { id: 'FIN001',  firstName: 'Patricia', lastName: 'Lim',    email: 'finance@cpi.com.ph',   password: 'finance123', roles: ['Finance', 'Employee'] as const,          team: 'Finance',            managerId: null, jobTitle: 'Finance Controller' },
  { id: 'HEAD001', firstName: 'Roberto',  lastName: 'Cruz',   email: 'head@cpi.com.ph',      password: 'head123',    roles: ['Admin', 'Manager', 'Employee'] as const, team: 'IT/Platforms',      managerId: null, jobTitle: 'IT Department Head' },
];

// ── Settings / Taxonomy ───────────────────────────────────────────────────────
// Mirrors ClientsConfigContext SEED_* constants.

const TEAMS = [
  'IT/Platforms', 'HR', 'Finance', 'Geniisys', 'Ancillary Solutions',
  'BD/Mktg/Sales', 'Business',
];

// "Internal" is NOT a real client — it's the FALLBACK_CLIENT label baked
// into the frontend dropdown via buildSharedClientList(). Seeding it as
// a Client row creates two SelectItems with value="Internal" (the fallback
// + the real row), which causes the Workspace trigger to render the
// label twice → "InternalInternal".
const CLIENTS = [
  'AFPGEN', 'AUII', 'CPAIC', 'FGEN', 'MIC', 'NIA',
  'PFIC', 'PNBGEN', 'UCPB', 'CIC', 'FLT', 'Meridian',
];

const MAIN_CATEGORIES = [
  'General Work', 'Projects', 'HR', 'IT', 'BD/Mktg/Sales', 'Finance',
];

const SUB_CATEGORIES = [
  { name: 'Geniisys',     parentMainCategory: 'Projects', clients: ['AFPGEN', 'AUII', 'CPAIC'] },
  { name: 'Quick Policy', parentMainCategory: 'Projects', clients: ['AFPGEN', 'AUII', 'PNBGEN', 'CPAIC'] },
];

const WORK_TYPES = [
  // General Work
  { name: 'Administrative',    parents: ['General Work'] },
  { name: 'Meetings',          parents: ['General Work', 'HR', 'Geniisys', 'Quick Policy', 'IT', 'BD/Mktg/Sales', 'Finance'] },
  { name: 'Training',          parents: ['General Work', 'HR'] },
  { name: 'Documentation',     parents: ['General Work', 'Geniisys', 'Quick Policy', 'IT'] },
  { name: 'Communication',     parents: ['General Work'] },
  { name: 'Research',          parents: ['General Work', 'BD/Mktg/Sales'] },
  // Projects — via sub categories
  { name: 'Implementation',    parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Enhancement',       parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Maintenance',       parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Product Development', parents: ['Geniisys', 'Quick Policy'] },
  { name: 'Support',           parents: ['Geniisys', 'Quick Policy', 'IT'] },
  { name: 'Testing',           parents: ['Geniisys', 'Quick Policy'] },
  // HR
  { name: 'Recruitment',       parents: ['HR'] },
  { name: 'Onboarding',        parents: ['HR'] },
  { name: 'Policy',            parents: ['HR'] },
  { name: 'Compliance',        parents: ['HR', 'Finance'] },
  { name: 'Engagement',        parents: ['HR'] },
  { name: 'Benefits',          parents: ['HR'] },
  // IT
  { name: 'Infrastructure',    parents: ['IT'] },
  { name: 'Security',          parents: ['IT'] },
  { name: 'DevOps',            parents: ['IT'] },
  { name: 'Helpdesk',          parents: ['IT'] },
  { name: 'Networking',        parents: ['IT'] },
  { name: 'Monitoring',        parents: ['IT'] },
  // BD/Mktg/Sales
  { name: 'Lead Generation',   parents: ['BD/Mktg/Sales'] },
  { name: 'Client Relations',  parents: ['BD/Mktg/Sales'] },
  { name: 'Proposals',         parents: ['BD/Mktg/Sales'] },
  { name: 'Marketing Campaign', parents: ['BD/Mktg/Sales'] },
  { name: 'Sales',             parents: ['BD/Mktg/Sales'] },
  // Finance
  { name: 'Budgeting',         parents: ['Finance'] },
  { name: 'Reporting',         parents: ['Finance'] },
  { name: 'Audit',             parents: ['Finance'] },
  { name: 'Forecasting',       parents: ['Finance'] },
];

const INFERENCE_RULES = [
  { keywords: ['server', 'infrastructure', 'aws', 'cloud', 'migration', 'vm', 'hosting', 'm365', 'microsoft 365', 'o365'], category: 'IT', workType: 'Infrastructure' },
  { keywords: ['security', 'audit', 'firewall', 'vulnerability', 'pentest', 'penetration test'], category: 'IT', workType: 'Security' },
  { keywords: ['devops', 'ci/cd', 'pipeline', 'docker', 'kubernetes'], category: 'IT', workType: 'DevOps' },
  { keywords: ['helpdesk', 'ticket', 'support request'], category: 'IT', workType: 'Helpdesk' },
  { keywords: ['network', 'connectivity', 'dns', 'vpn'], category: 'IT', workType: 'Networking' },
  { keywords: ['monitoring', 'downtime', 'uptime', 'alerting'], category: 'IT', workType: 'Monitoring' },
  { keywords: ['marketing', 'campaign', 'content', 'branding', 'advertising'], category: 'BD/Mktg/Sales', workType: 'Marketing Campaign' },
  { keywords: ['lead generation', 'sales lead', 'prospect'], category: 'BD/Mktg/Sales', workType: 'Lead Generation' },
  { keywords: ['proposal', 'rfp', 'bid'], category: 'BD/Mktg/Sales', workType: 'Proposals' },
  { keywords: ['sales', 'revenue', 'deal', 'closing'], category: 'BD/Mktg/Sales', workType: 'Sales' },
  { keywords: ['interview', 'recruitment', 'hiring', 'candidate', 'technical interview'], category: 'HR', workType: 'Recruitment' },
  { keywords: ['onboarding', 'orientation', 'new hire'], category: 'HR', workType: 'Onboarding' },
  { keywords: ['policy', 'handbook', 'compliance'], category: 'HR', workType: 'Policy' },
  { keywords: ['training', 'workshop', 'upskilling'], category: 'HR', workType: 'Training' },
  { keywords: ['meeting', 'standup', 'sync', '1:1', 'catchup', 'tech lead', 'team lead'], category: 'General Work', workType: 'Meetings' },
  { keywords: ['documentation', 'wiki', 'readme', 'doc'], category: 'General Work', workType: 'Documentation' },
  { keywords: ['research', 'spike', 'investigation'], category: 'General Work', workType: 'Research' },
  { keywords: ['admin', 'administrative'], category: 'General Work', workType: 'Administrative' },
  { keywords: ['email', 'communication', 'update'], category: 'General Work', workType: 'Communication' },
  { keywords: ['budget', 'forecast', 'variance'], category: 'Finance', workType: 'Budgeting' },
  { keywords: ['reporting', 'report'], category: 'Finance', workType: 'Reporting' },
  { keywords: ['implementation', 'implement', 'rollout implementation', 'integration'], category: 'Projects', subCategory: 'Geniisys', workType: 'Implementation' },
  { keywords: ['enhancement', 'enhance', 'improvement'], category: 'Projects', subCategory: 'Geniisys', workType: 'Enhancement' },
  { keywords: ['maintenance', 'maintain', 'patch', 'hotfix', 'bugfix', 'bug fix'], category: 'Projects', subCategory: 'Geniisys', workType: 'Maintenance' },
  { keywords: ['testing', 'qa', 'uat'], category: 'Projects', subCategory: 'Geniisys', workType: 'Testing' },
  { keywords: ['support', 'assisting', 'assist'], category: 'Projects', subCategory: 'Geniisys', workType: 'Support' },
  { keywords: ['product development', 'product dev'], category: 'Projects', subCategory: 'Quick Policy', workType: 'Product Development' },
];

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
