import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { logAuditTx } from '../lib/audit.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';
import {
  AddNameSchema,
  RenameSchema,
  AddSubCategorySchema,
  SetSubCategoryClientsSchema,
  AddWorkTypeSchema,
  SetWorkTypeParentsSchema,
  BulkInferenceRulesSchema,
  NumericIdParamSchema,
} from 'cpi-work-allocation-shared';

// ── Snapshot ────────────────────────────────────────────────────────────────

export async function snapshot(_req: Request, res: Response): Promise<void> {
  const [teams, clients, mainCats, subCats, workTypes, inferenceRules] = await Promise.all([
    prisma.team.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.client.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.mainCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.subCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { mainCategory: { select: { name: true } } },
    }),
    prisma.workType.findMany({ orderBy: { name: 'asc' } }),
    prisma.inferenceRule.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  res.json({
    teams: teams.map((t) => ({ id: t.id, name: t.name, sortOrder: t.sortOrder })),
    clients: clients.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
    mainCategories: mainCats.map((mc) => ({ id: mc.id, name: mc.name, sortOrder: mc.sortOrder })),
    subCategories: subCats.map((sc) => ({
      id: sc.id,
      name: sc.name,
      parentMainCategory: sc.mainCategory.name,
      mainCategoryId: sc.mainCategoryId,
      clients: sc.clients,
      sortOrder: sc.sortOrder,
    })),
    workTypes: workTypes.map((wt) => ({ id: wt.id, name: wt.name, parents: wt.parents })),
    inferenceRules: inferenceRules.map((ir) => ({
      id: ir.id,
      keywords: ir.keywords,
      category: ir.category,
      subCategory: ir.subCategory,
      workType: ir.workType,
      sortOrder: ir.sortOrder,
    })),
  });
}

// ── Teams ───────────────────────────────────────────────────────────────────

export async function createTeam(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, AddNameSchema);
  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: { name: body.name, sortOrder: body.sortOrder },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'create',
      entity: 'Team',
      entityId: String(created.id),
      payload: { name: created.name, sortOrder: created.sortOrder },
    });
    return created;
  });
  res.status(201).json(team);
}

export async function renameTeam(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, RenameSchema);
  const team = await prisma.$transaction(async (tx) => {
    const updated = await tx.team.update({ where: { id }, data: { name: body.name } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'Team',
      entityId: String(updated.id),
      payload: { name: updated.name },
    });
    return updated;
  });
  res.json(team);
}

export async function deleteTeam(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    await tx.team.delete({ where: { id } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'delete',
      entity: 'Team',
      entityId: String(id),
    });
  });
  res.status(204).send();
}

// ── Clients ─────────────────────────────────────────────────────────────────

export async function createClient(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, AddNameSchema);
  const client = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: { name: body.name, sortOrder: body.sortOrder },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'create',
      entity: 'Client',
      entityId: String(created.id),
      payload: { name: created.name, sortOrder: created.sortOrder },
    });
    return created;
  });
  res.status(201).json(client);
}

export async function renameClient(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, RenameSchema);
  const client = await prisma.$transaction(async (tx) => {
    const updated = await tx.client.update({ where: { id }, data: { name: body.name } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'Client',
      entityId: String(updated.id),
      payload: { name: updated.name },
    });
    return updated;
  });
  res.json(client);
}

export async function deleteClient(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    await tx.client.delete({ where: { id } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'delete',
      entity: 'Client',
      entityId: String(id),
    });
  });
  res.status(204).send();
}

// ── Main Categories ─────────────────────────────────────────────────────────

export async function createMainCategory(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, AddNameSchema);
  const cat = await prisma.$transaction(async (tx) => {
    const created = await tx.mainCategory.create({
      data: { name: body.name, sortOrder: body.sortOrder },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'create',
      entity: 'MainCategory',
      entityId: String(created.id),
      payload: { name: created.name, sortOrder: created.sortOrder },
    });
    return created;
  });
  res.status(201).json(cat);
}

export async function renameMainCategory(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, RenameSchema);
  const cat = await prisma.$transaction(async (tx) => {
    const updated = await tx.mainCategory.update({ where: { id }, data: { name: body.name } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'MainCategory',
      entityId: String(updated.id),
      payload: { name: updated.name },
    });
    return updated;
  });
  res.json(cat);
}

export async function deleteMainCategory(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    await tx.mainCategory.delete({ where: { id } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'delete',
      entity: 'MainCategory',
      entityId: String(id),
    });
  });
  res.status(204).send();
}

// ── Sub-categories ──────────────────────────────────────────────────────────

export async function createSubCategory(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, AddSubCategorySchema);
  const parent = await prisma.mainCategory.findUnique({
    where: { id: body.parentMainCategoryId },
  });
  if (!parent) {
    res.status(400).json({ error: 'Main category not found' });
    return;
  }
  const sub = await prisma.$transaction(async (tx) => {
    const created = await tx.subCategory.create({
      data: {
        name: body.name,
        mainCategoryId: body.parentMainCategoryId,
        clients: body.clients,
        sortOrder: body.sortOrder,
      },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'create',
      entity: 'SubCategory',
      entityId: String(created.id),
      payload: {
        name: created.name,
        mainCategoryId: created.mainCategoryId,
        clients: created.clients,
      },
    });
    return created;
  });
  res.status(201).json(sub);
}

export async function renameSubCategory(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, RenameSchema);
  const sub = await prisma.$transaction(async (tx) => {
    const updated = await tx.subCategory.update({ where: { id }, data: { name: body.name } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'SubCategory',
      entityId: String(updated.id),
      payload: { name: updated.name },
    });
    return updated;
  });
  res.json(sub);
}

export async function setSubCategoryClients(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, SetSubCategoryClientsSchema);
  const sub = await prisma.$transaction(async (tx) => {
    const updated = await tx.subCategory.update({
      where: { id },
      data: { clients: body.clients },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update-clients',
      entity: 'SubCategory',
      entityId: String(updated.id),
      payload: { clients: updated.clients },
    });
    return updated;
  });
  res.json(sub);
}

export async function deleteSubCategory(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    await tx.subCategory.delete({ where: { id } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'delete',
      entity: 'SubCategory',
      entityId: String(id),
    });
  });
  res.status(204).send();
}

// ── Work Types ──────────────────────────────────────────────────────────────

export async function createWorkType(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, AddWorkTypeSchema);
  const wt = await prisma.$transaction(async (tx) => {
    const created = await tx.workType.create({
      data: { name: body.name, parents: body.parents },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'create',
      entity: 'WorkType',
      entityId: String(created.id),
      payload: { name: created.name, parents: created.parents },
    });
    return created;
  });
  res.status(201).json(wt);
}

export async function renameWorkType(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, RenameSchema);
  const wt = await prisma.$transaction(async (tx) => {
    const updated = await tx.workType.update({ where: { id }, data: { name: body.name } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'WorkType',
      entityId: String(updated.id),
      payload: { name: updated.name },
    });
    return updated;
  });
  res.json(wt);
}

export async function setWorkTypeParents(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, SetWorkTypeParentsSchema);
  const wt = await prisma.$transaction(async (tx) => {
    const updated = await tx.workType.update({
      where: { id },
      data: { parents: body.parents },
    });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update-parents',
      entity: 'WorkType',
      entityId: String(updated.id),
      payload: { parents: updated.parents },
    });
    return updated;
  });
  res.json(wt);
}

export async function deleteWorkType(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    await tx.workType.delete({ where: { id } });
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'delete',
      entity: 'WorkType',
      entityId: String(id),
    });
  });
  res.status(204).send();
}

// ── Inference Rules (bulk replace) ──────────────────────────────────────────

export async function bulkReplaceInferenceRules(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const body = getValid(req, BulkInferenceRulesSchema);
  await prisma.$transaction(async (tx) => {
    await tx.inferenceRule.deleteMany({});
    for (let i = 0; i < body.rules.length; i++) {
      const rule = body.rules[i];
      await tx.inferenceRule.create({
        data: {
          keywords: rule.keywords,
          category: rule.category,
          subCategory: rule.subCategory ?? null,
          workType: rule.workType,
          sortOrder: rule.sortOrder ?? i,
        },
      });
    }
    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'bulk-replace',
      entity: 'InferenceRule',
      entityId: 'all',
      payload: { count: body.rules.length },
    });
  });
  const rules = await prisma.inferenceRule.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json(rules);
}
