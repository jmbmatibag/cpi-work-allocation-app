/**
 * Non-working-time exclusion in the Finance sheet.
 *
 * Deliberately a separate, DB-FREE file: src/__tests__/financeExport.ts pulls
 * in prisma + supertest for the HTTP route, so the whole suite dies in
 * afterAll when the local Postgres container is down. buildFinanceRows is a
 * pure function — the rule that Finance never sees leave should be verifiable
 * without a database.
 */
import { describe, it, expect } from 'vitest';
import { buildFinanceRows, type RecordSource } from '../financeExport.js';

const ROSTER = ['MTC API', 'Smart Claims'];

/** One record with the given activities; everything else is boilerplate. */
function recordWith(activities: RecordSource['activities']): RecordSource {
  return {
    employeeId: 'E1',
    team: 'Team A',
    month: 'March',
    year: '2099',
    status: 'Approved',
    employee: { firstName: 'A', lastName: 'B' },
    activities,
  };
}

describe('buildFinanceRows — non-working time is excluded', () => {
  it('drops every leave / holiday work type', () => {
    const leaveTypes = [
      'Holiday',
      'Leave',
      'Sick Leave',
      'Vacation Leave',
      'Maternity Leave',
      'Paternity Leave',
      'Sabbatical Leave',
    ];

    const rows = buildFinanceRows(
      [
        recordWith(
          leaveTypes.map((workType) => ({
            streamCategory: 'General Work',
            subCategory: 'OTHERS',
            workType,
            client: 'Internal',
            description: workType,
            percentage: 100 / leaveTypes.length,
          })),
        ),
      ],
      ROSTER,
    );

    expect(rows).toEqual([]);
  });

  it('matches the work type case-insensitively', () => {
    // The live taxonomy stores "OTHERS" uppercase and work types arrive in
    // mixed casing — a case-sensitive compare is the bug that previously
    // blanked both dropdowns on the leave path.
    const rows = buildFinanceRows(
      [
        recordWith([
          {
            streamCategory: 'General Work',
            subCategory: 'OTHERS',
            workType: 'SICK LEAVE',
            client: 'Internal',
            description: 'out sick',
            percentage: 50,
          },
          {
            streamCategory: 'General Work',
            subCategory: 'Others',
            workType: '  vacation leave  ',
            client: 'Internal',
            description: 'on holiday',
            percentage: 50,
          },
        ]),
      ],
      ROSTER,
    );

    expect(rows).toEqual([]);
  });

  it('keeps real work that merely sits under the OTHERS sub category', () => {
    // OTHERS is a catch-all bucket, not a leave bucket. Excluding the whole
    // sub category would silently delete legitimate billable work.
    const rows = buildFinanceRows(
      [
        recordWith([
          {
            streamCategory: 'General Work',
            subCategory: 'OTHERS',
            workType: 'Administrative',
            client: 'Internal',
            description: 'timesheet reconciliation',
            percentage: 100,
          },
        ]),
      ],
      ROSTER,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].category1).toBe('Administrative');
  });

  it('keeps working rows untouched alongside leave rows', () => {
    const rows = buildFinanceRows(
      [
        recordWith([
          {
            streamCategory: 'Geniisys',
            subCategory: null,
            workType: 'Enhancement',
            client: 'AUII',
            description: 'SR 41631 payout screen',
            percentage: 60,
          },
          {
            streamCategory: 'General Work',
            subCategory: 'OTHERS',
            workType: 'Sick Leave',
            client: 'Internal',
            description: 'sick leave',
            percentage: 40,
          },
        ]),
      ],
      ROSTER,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].mainCategory).toBe('Geniisys');
    expect(rows[0].category2).toBe('Enhancement - SR 41631');
    // The surviving row keeps its ORIGINAL percentage — exclusion removes the
    // line, it does not re-normalise the remainder to 100.
    expect(rows[0].percentage).toBe(60);
  });

  it('does not exclude on description text alone', () => {
    // The Finance gate is work-type driven, unlike the journal gate which has
    // no taxonomy to read. A real project named "Holiday Promo" must survive.
    const rows = buildFinanceRows(
      [
        recordWith([
          {
            streamCategory: 'Projects',
            subCategory: 'Marketing Site',
            workType: 'Development',
            client: 'ACME',
            description: 'Holiday Promo landing page',
            percentage: 100,
          },
        ]),
      ],
      ROSTER,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Holiday Promo landing page');
  });
});
