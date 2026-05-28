import type { Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { logAuditTx } from '../lib/audit.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import {
  UpsertJournalEntrySchema,
  ListJournalQuerySchema,
  DateParamSchema,
} from 'cpi-work-allocation-shared';
import { buildAllocationScopeFilter } from '../lib/scope.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResponse(e: any) {
  return {
    employeeId: e.employeeId as string,
    date: e.date as string,
    content: e.content as string,
    ...(e.blocks != null && { blocks: e.blocks }),
    updatedAt: (e.updatedAt as Date).toISOString(),
  };
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
  const { employeeId, year, month } = getValid(req, ListJournalQuerySchema, 'query');

  const scopeResult = await buildAllocationScopeFilter(req.userId, req.userRoles, employeeId);
  if (!scopeResult.ok) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = scopeResult.filter ? { ...scopeResult.filter } : {};
  if (year && month) {
    where.date = { startsWith: `${year}-${String(parseInt(month)).padStart(2, '0')}` };
  } else if (year) {
    where.date = { startsWith: year };
  }

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: { date: 'desc' },
  });

  res.json(entries.map(toResponse));
}

export async function getByDate(req: AuthRequest, res: Response): Promise<void> {
  const { date } = getValid(req, DateParamSchema, 'params');

  const entry = await prisma.journalEntry.findUnique({
    where: { employeeId_date: { employeeId: req.userId!, date } },
  });

  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }

  res.json(toResponse(entry));
}

export async function upsertByDate(req: AuthRequest, res: Response): Promise<void> {
  const { date } = getValid(req, DateParamSchema, 'params');
  const body = getValid(req, UpsertJournalEntrySchema);

  const entry = await prisma.journalEntry.upsert({
    where: { employeeId_date: { employeeId: req.userId!, date } },
    create: {
      employeeId: req.userId!,
      date,
      content: body.content,
      blocks: body.blocks ?? undefined,
    },
    update: {
      content: body.content,
      blocks: body.blocks ?? undefined,
    },
  });

  res.json(toResponse(entry));
}

export async function deleteByDate(req: AuthRequest, res: Response): Promise<void> {
  const { date } = getValid(req, DateParamSchema, 'params');

  const existing = await prisma.journalEntry.findUnique({
    where: { employeeId_date: { employeeId: req.userId!, date } },
  });
  if (!existing) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.journalEntry.delete({
      where: { employeeId_date: { employeeId: req.userId!, date } },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'delete',
      entity: 'JournalEntry',
      entityId: existing.id,
      payload: { date },
    });
  });

  res.status(204).send();
}
