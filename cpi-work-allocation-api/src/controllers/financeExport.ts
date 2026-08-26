import type { Response } from 'express';
import {
  FinanceExportQuerySchema,
  getReportingPeriod,
} from 'cpi-work-allocation-shared';
import type { AllocationStatus } from '../generated/prisma/client.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit.js';
import { buildFinanceRows, toFinanceCsv } from '../lib/financeExport.js';

export async function exportForFinance(req: AuthRequest, res: Response): Promise<void> {
  const q = getValid(req, FinanceExportQuerySchema, 'query');

  // Reporting views default to the PREVIOUS month (global arrears rule) — the
  // same helper every other reporting surface uses. Never "now": on the 1st of
  // the month that would return an empty sheet.
  const fallback = getReportingPeriod();
  const month = q.month ?? fallback.month;
  const year = q.year ?? fallback.year;

  // Live Enhancement roster — the parser fallback must agree with whatever
  // an Admin currently has in Settings, so it is read per export rather than
  // baked in at module load.
  const enhancementRoster = (
    await prisma.enhancement.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true },
    })
  ).map((e) => e.name);

  const records = await prisma.allocationRecord.findMany({
    where: {
      month,
      year,
      ...(q.status !== 'all' && { status: q.status as AllocationStatus }),
      ...(q.team && { team: q.team }),
      ...(q.employeeId && { employeeId: q.employeeId }),
    },
    include: {
      employee: { select: { firstName: true, lastName: true } },
      activities: { orderBy: [{ streamOrder: 'asc' }, { activityOrder: 'asc' }] },
    },
    orderBy: [{ team: 'asc' }, { employeeId: 'asc' }],
  });

  const rows = buildFinanceRows(records, enhancementRoster);

  // Exports carry every employee's allocation off the system boundary — log
  // who pulled what, and when.
  await logAudit({
    userId: req.userId!,
    action: 'finance-export',
    entity: 'AllocationRecord',
    entityId: `${month}-${year}`,
    payload: {
      month,
      year,
      status: q.status,
      team: q.team ?? null,
      employeeId: q.employeeId ?? null,
      format: q.format,
      rowCount: rows.length,
    },
  });

  if (q.format === 'json') {
    res.json({ period: `${month} ${year}`, rowCount: rows.length, rows });
    return;
  }

  const slug = `${month}-${year}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cpi-finance-${slug}.csv"`);
  // UTF-8 BOM so Excel doesn't mangle non-ASCII client names on open.
  res.send('\uFEFF' + toFinanceCsv(rows));
}
