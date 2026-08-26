/**
 * Finance export integration tests.
 *
 * Covers the three-column mapping Finance asked for, the role gate (the
 * endpoint returns EVERY employee's allocation in one response, so it must be
 * Finance/Admin only), and the RFC 4180 quoting the CSV writer relies on.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import {
  extractWorkReference,
  extractEnhancementTag,
  resolveEnhancement,
  buildFinanceRows,
  toFinanceCsv,
} from '../lib/financeExport.js';

vi.mock('../lib/mailer.js', () => ({ sendOtpEmail: vi.fn() }));

const SESSION = 'sess-finance-export';
const PW_UPDATED = new Date('2020-01-01T00:00:00Z');

const TEST_FINANCE = {
  id: 'TEST_FX_FIN',
  firstName: 'Fin',
  lastName: 'Tester',
  email: 'fx.finance@cpi.com.ph',
  roles: ['Finance'] as ('Employee' | 'Manager' | 'Finance' | 'Admin')[],
  team: '__fx_team',
  jobTitle: 'Tester',
};

const TEST_EMPLOYEE = {
  id: 'TEST_FX_EMP',
  firstName: 'Emp',
  lastName: 'Tester',
  email: 'fx.employee@cpi.com.ph',
  roles: ['Employee'] as ('Employee' | 'Manager' | 'Finance' | 'Admin')[],
  team: '__fx_team',
  jobTitle: 'Tester',
};

const RECORD_ID = 'ALC-TEST-FX-0001';
const MONTH = 'March';
const YEAR = '2099'; // far-future so it can never collide with real data

const app = createApp();

function makeAuthCookie(userId: string, roles: string[]): string {
  const token = jwt.sign({ sub: userId, roles, sessionId: SESSION }, process.env.JWT_SECRET!, {
    expiresIn: 3600,
    algorithm: 'HS256',
  });
  return `auth_token=${token}`;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('test', 10);
  for (const u of [TEST_FINANCE, TEST_EMPLOYEE]) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        ...u,
        passwordHash,
        managerId: null,
        activeSessionId: SESSION,
        passwordUpdatedAt: PW_UPDATED,
      },
      update: { activeSessionId: SESSION, passwordUpdatedAt: PW_UPDATED },
    });
  }

  await prisma.allocationRecord.deleteMany({ where: { id: RECORD_ID } });
  await prisma.allocationRecord.create({
    data: {
      id: RECORD_ID,
      employeeId: TEST_EMPLOYEE.id,
      team: '__fx_team',
      managerId: null,
      month: MONTH,
      year: YEAR,
      monthIndex: 2,
      status: 'Approved',
      activities: {
        create: [
          {
            // Post-flatten shape: the project IS the category, no sub tier.
            streamCategory: 'Geniisys',
            subCategory: null,
            workType: 'Enhancement',
            client: 'AUII',
            description: 'Built the payout screen for SR 41631',
            percentage: 60,
            streamOrder: 0,
            activityOrder: 0,
          },
          {
            streamCategory: 'Geniisys',
            subCategory: null,
            workType: 'Support',
            client: 'AFPGEN',
            // No reference in the text — Category 2 must fall back to the
            // bare work type rather than inventing one.
            description: 'Answered questions, ran a "quick" check',
            percentage: 40,
            streamOrder: 0,
            activityOrder: 1,
          },
        ],
      },
    },
  });
});

afterAll(async () => {
  await prisma.allocationRecord.deleteMany({ where: { id: RECORD_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [TEST_FINANCE.id, TEST_EMPLOYEE.id] } } });
  await prisma.auditLog.deleteMany({ where: { entityId: `${MONTH}-${YEAR}` } });
  await prisma.$disconnect();
});

// Explicit roster, mirroring what the Enhancement table seeds. Passed in
// everywhere rather than defaulted, so a test can never pass against a list
// the running app would not have used.
const ROSTER = [
  'MTC API',
  'Smart Claims',
  'OAuth/OIDC',
  'Plate Number Validation',
  'Treaty Limit',
  'GISTP2.5',
];

describe('extractWorkReference', () => {
  it('normalises separator and case on ticket references', () => {
    expect(extractWorkReference('work on SR 41631 today')).toBe('SR 41631');
    expect(extractWorkReference('work on sr-41631 today')).toBe('SR 41631');
    expect(extractWorkReference('work on CR#204')).toBe('CR 204');
  });

  it('recognises plate numbers and project keys', () => {
    expect(extractWorkReference('inspection for ABC 1234')).toBe('ABC 1234');
    expect(extractWorkReference('closed JIRA-1420')).toBe('JIRA-1420');
  });

  it('returns null rather than guessing when there is no reference', () => {
    expect(extractWorkReference('routine standup and planning')).toBeNull();
    expect(extractWorkReference('')).toBeNull();
  });
});

describe('buildFinanceRows', () => {
  it('maps a flattened project to the three Finance columns', () => {
    const rows = buildFinanceRows([
      {
        employeeId: 'E1',
        team: 'T',
        month: 'March',
        year: '2099',
        status: 'Approved',
        employee: { firstName: 'A', lastName: 'B' },
        activities: [
          {
            streamCategory: 'Geniisys',
            subCategory: null,
            workType: 'Enhancement',
            client: 'AUII',
            description: 'SR 41631 payout screen',
            percentage: 100,
          },
        ],
      },
    ], ROSTER);

    expect(rows[0].mainCategory).toBe('Geniisys');
    expect(rows[0].category1).toBe('Enhancement');
    expect(rows[0].category2).toBe('Enhancement - SR 41631');
  });

  it('emits the project name even on pre-flatten rows', () => {
    // Transitional guard: run against a database where flatten-projects.ts
    // has not been applied yet, Column 1 must still be the project rather
    // than the useless parent string "Projects".
    const rows = buildFinanceRows([
      {
        employeeId: 'E1',
        team: 'T',
        month: 'March',
        year: '2099',
        status: 'Approved',
        employee: { firstName: 'A', lastName: 'B' },
        activities: [
          {
            streamCategory: 'Projects',
            subCategory: 'Geniisys',
            workType: 'Enhancement',
            client: 'AUII',
            description: 'no reference here',
            percentage: 100,
          },
        ],
      },
    ], ROSTER);

    expect(rows[0].mainCategory).toBe('Geniisys');
    // No reference found -> bare work type, not a fabricated one.
    expect(rows[0].category2).toBe('Enhancement');
  });
});

describe('enhancement tag', () => {

  const base = {
    streamCategory: 'Geniisys',
    subCategory: null,
    client: 'AUII',
    percentage: 100,
  };

  it('prefers the stored tag over anything in the description', () => {
    // Priority 1. A human picked this from a fixed list; the description
    // naming a DIFFERENT enhancement must not override it.
    expect(
      resolveEnhancement({
        ...base,
        workType: 'Specific Enhancement',
        enhancementTag: 'Treaty Limit',
        description: 'worked on Smart Claims today',
      }, ROSTER),
    ).toBe('Treaty Limit');
  });

  it('falls back to parsing the description on historical rows', () => {
    // Priority 2. enhancementTag is null because the row predates the column.
    expect(
      resolveEnhancement({
        ...base,
        workType: 'Specific Enhancement',
        enhancementTag: null,
        description: 'fixed the mtc api timeout',
      }, ROSTER),
    ).toBe('MTC API');
  });

  it('does not parse descriptions of non-enhancement work', () => {
    // The fallback is gated on work type so a passing mention never
    // mislabels an unrelated task.
    expect(
      resolveEnhancement({
        ...base,
        workType: 'Support',
        enhancementTag: null,
        description: 'answered a question about Smart Claims',
      }, ROSTER),
    ).toBe('');
  });

  it('leaves the column blank rather than guessing', () => {
    expect(
      resolveEnhancement({
        ...base,
        workType: 'Specific Enhancement',
        enhancementTag: null,
        description: 'general cleanup, nothing named',
      }, ROSTER),
    ).toBe('');
  });

  it('tolerates casing, spacing and separator noise', () => {
    expect(extractEnhancementTag('SMART   CLAIMS regression', ROSTER)).toBe('Smart Claims');
    expect(extractEnhancementTag('oauth / oidc rollout', ROSTER)).toBe('OAuth/OIDC');
    expect(extractEnhancementTag('OAuth-OIDC rollout', ROSTER)).toBe('OAuth/OIDC');
    expect(extractEnhancementTag('gistp 2.5 migration', ROSTER)).toBe('GISTP2.5');
    expect(extractEnhancementTag('plate number validation bug', ROSTER)).toBe(
      'Plate Number Validation',
    );
  });

  it('respects word boundaries', () => {
    // Substring hits inside a longer token are not the tag.
    expect(extractEnhancementTag('XMTC APIX something', ROSTER)).toBeNull();
    expect(extractEnhancementTag('', ROSTER)).toBeNull();
  });

  it('surfaces the tag as its own export column', () => {
    const rows = buildFinanceRows([
      {
        employeeId: 'E1',
        team: 'T',
        month: 'March',
        year: '2099',
        status: 'Approved',
        employee: { firstName: 'A', lastName: 'B' },
        activities: [
          {
            ...base,
            workType: 'Specific Enhancement',
            enhancementTag: 'Smart Claims',
            description: 'SR 41631 payout screen',
          },
        ],
      },
    ], ROSTER);

    expect(rows[0].enhancement).toBe('Smart Claims');
    // The three mandated Finance columns are untouched by the addition.
    expect(rows[0].category1).toBe('Specific Enhancement');
    expect(rows[0].category2).toBe('Specific Enhancement - SR 41631');
  });
});

describe('toFinanceCsv', () => {
  it('quotes and escapes per RFC 4180', () => {
    const csv = toFinanceCsv([
      {
        mainCategory: 'Geniisys',
        category1: 'Support',
        category2: 'Support',
        enhancement: '',
        employeeId: 'E1',
        employeeName: 'A B',
        team: 'T',
        client: 'AUII',
        percentage: 100,
        period: 'March 2099',
        status: 'Approved',
        description: 'has "quotes", a comma\nand a newline',
      },
    ]);

    expect(csv).toContain('"has ""quotes"", a comma\nand a newline"');
    expect(csv.split('\r\n')[0]).toBe(
      'Main Category,Category 1,Category 2,Enhancement,Employee ID,Employee Name,Team,Client,%,Period,Status,Description',
    );
  });
});

describe('GET /api/finance-export', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/finance-export');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a plain Employee', async () => {
    const res = await request(app)
      .get('/api/finance-export')
      .query({ month: MONTH, year: YEAR })
      .set('Cookie', makeAuthCookie(TEST_EMPLOYEE.id, TEST_EMPLOYEE.roles));
    expect(res.status).toBe(403);
  });

  it('returns CSV with the Finance column mapping', async () => {
    const res = await request(app)
      .get('/api/finance-export')
      .query({ month: MONTH, year: YEAR })
      .set('Cookie', makeAuthCookie(TEST_FINANCE.id, TEST_FINANCE.roles));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('cpi-finance-march-2099.csv');

    const body = res.text;
    expect(body.charCodeAt(0)).toBe(0xfeff); // Excel BOM
    expect(body).toContain('Geniisys,Enhancement,Enhancement - SR 41631');
    // Second row has no reference — Category 2 collapses to the work type.
    expect(body).toContain('Geniisys,Support,Support');
  });

  it('returns JSON when format=json', async () => {
    const res = await request(app)
      .get('/api/finance-export')
      .query({ month: MONTH, year: YEAR, format: 'json' })
      .set('Cookie', makeAuthCookie(TEST_FINANCE.id, TEST_FINANCE.roles));

    expect(res.status).toBe(200);
    expect(res.body.period).toBe(`${MONTH} ${YEAR}`);
    expect(res.body.rowCount).toBe(2);
    expect(res.body.rows[0].category2).toBe('Enhancement - SR 41631');
  });

  it('defaults to Approved only', async () => {
    // Flip the fixture to Draft; the default filter should now exclude it.
    await prisma.allocationRecord.update({
      where: { id: RECORD_ID },
      data: { status: 'Draft' },
    });

    const res = await request(app)
      .get('/api/finance-export')
      .query({ month: MONTH, year: YEAR, format: 'json' })
      .set('Cookie', makeAuthCookie(TEST_FINANCE.id, TEST_FINANCE.roles));
    expect(res.body.rowCount).toBe(0);

    const all = await request(app)
      .get('/api/finance-export')
      .query({ month: MONTH, year: YEAR, format: 'json', status: 'all' })
      .set('Cookie', makeAuthCookie(TEST_FINANCE.id, TEST_FINANCE.roles));
    expect(all.body.rowCount).toBe(2);

    await prisma.allocationRecord.update({
      where: { id: RECORD_ID },
      data: { status: 'Approved' },
    });
  });
});
