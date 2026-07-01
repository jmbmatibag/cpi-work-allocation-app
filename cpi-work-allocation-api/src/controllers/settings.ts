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
  BulkUpdateWorkTypeParentsSchema,
  NumericIdParamSchema,
} from 'cpi-work-allocation-shared';

// ── Name sanitization ────────────────────────────────────────────────────────

/** Collapse interior whitespace and strip leading/trailing spaces from a taxonomy name. */
function sanitizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'by', 'for', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with',
]);

/**
 * Produce a keyword array for a work type name.
 * Multi-word names get the full phrase PLUS each individual non-stop-word token.
 *
 * "Product Development"    → ["product development", "product", "development"]
 * "Development"            → ["development"]
 * "Sales, Marketing & BD"  → ["sales marketing bd", "sales", "marketing", "bd"]
 *
 * Special characters (commas, ampersands, etc.) are stripped before
 * tokenising so they don't embed into individual keyword tokens and
 * then fail to match against plain-text descriptions.
 */
function tokenizeWorkTypeName(name: string): string[] {
  const lower = name.toLowerCase();
  const clean = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean.includes(' ')) return [clean];
  const words = clean.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set([clean, ...words])];
}

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
      data: { name: sanitizeName(body.name), sortOrder: body.sortOrder },
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
  const newName = sanitizeName(body.name);
  const cat = await prisma.$transaction(async (tx) => {
    const existing = await tx.mainCategory.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const oldName = existing.name;

    const updated = await tx.mainCategory.update({
      where: { id },
      data: { name: newName },
      include: { subCategories: true },
    });

    // Cascade rename into WorkType.parents (stored as String[] — no FK cascade)
    const affectedWorkTypes = await tx.workType.findMany({ where: { parents: { has: oldName } } });
    for (const wt of affectedWorkTypes) {
      await tx.workType.update({
        where: { id: wt.id },
        data: { parents: wt.parents.map((p) => (p === oldName ? newName : p)) },
      });
    }

    // Phase 2: sync InferenceRule.category string to the new name.
    // Keywords don't embed the main category name (they carry client/subCategory
    // names), so only the classification field needs updating here.
    await tx.inferenceRule.updateMany({
      where: { category: oldName },
      data: { category: newName },
    });

    // Repoint the denormalised category copy on saved allocation cards.
    // AllocationActivity.streamCategory is a plain string with no FK, so
    // without this a rename leaves existing cards showing the old name
    // (the "ghost category" bug).
    await tx.allocationActivity.updateMany({
      where: { streamCategory: oldName },
      data: { streamCategory: newName },
    });

    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'MainCategory',
      entityId: String(updated.id),
      payload: { name: updated.name, renamedFrom: oldName },
    });
    return updated;
  });
  res.json(cat);
}

export async function deleteMainCategory(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    const existing = await tx.mainCategory.findUniqueOrThrow({
      where: { id },
      select: { name: true, subCategories: { select: { name: true } } },
    });

    // All parent names being wiped: the main category itself + every child sub-category.
    // WorkType.parents is String[] (no FK), so stale names must be pruned manually.
    // Leaving them in place would cause work types to appear "pre-attached" if a new
    // category is ever created with the same name.
    const removedParentNames = new Set([
      existing.name,
      ...existing.subCategories.map((sc) => sc.name),
    ]);

    const affectedWorkTypes = await tx.workType.findMany({
      where: { parents: { hasSome: [...removedParentNames] } },
    });

    for (const wt of affectedWorkTypes) {
      await tx.workType.update({
        where: { id: wt.id },
        data: { parents: wt.parents.filter((p) => !removedParentNames.has(p)) },
      });
    }

    // Clean up pre-migration InferenceRules (subCategoryId = null) for this category.
    // FK-linked rules cascade automatically:
    //   MainCategory → SubCategory (Cascade) → InferenceRule (Cascade)
    await tx.inferenceRule.deleteMany({ where: { category: existing.name, subCategoryId: null } });

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
        name: sanitizeName(body.name),
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
  const newName = sanitizeName(body.name);
  const sub = await prisma.$transaction(async (tx) => {
    const existing = await tx.subCategory.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const oldName = existing.name;

    const updated = await tx.subCategory.update({ where: { id }, data: { name: newName } });

    // Cascade rename into WorkType.parents (stored as String[] — no FK cascade)
    const affectedWorkTypes = await tx.workType.findMany({ where: { parents: { has: oldName } } });
    for (const wt of affectedWorkTypes) {
      await tx.workType.update({
        where: { id: wt.id },
        data: { parents: wt.parents.map((p) => (p === oldName ? newName : p)) },
      });
    }

    // Phase 2: sync InferenceRule.subCategory and any keyword that carries the
    // old sub-category name (auto-generated rules embed it as a keyword).
    const affectedRules = await tx.inferenceRule.findMany({ where: { subCategory: oldName } });
    for (const rule of affectedRules) {
      await tx.inferenceRule.update({
        where: { id: rule.id },
        data: {
          subCategory: newName,
          keywords: rule.keywords.map((k) =>
            k === oldName.toLowerCase() ? newName.toLowerCase() : k
          ),
        },
      });
    }

    // Repoint the denormalised sub-category copy on saved allocation cards
    // (same rationale as renameMainCategory's streamCategory cascade).
    await tx.allocationActivity.updateMany({
      where: { subCategory: oldName },
      data: { subCategory: newName },
    });

    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'SubCategory',
      entityId: String(updated.id),
      payload: { name: updated.name, renamedFrom: oldName },
    });
    return updated;
  });
  res.json(sub);
}

export async function setSubCategoryClients(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, SetSubCategoryClientsSchema);

  const result = await prisma.$transaction(async (tx) => {
    // Fetch existing state so we can diff for newly added clients.
    const existing = await tx.subCategory.findUniqueOrThrow({
      where: { id },
      include: { mainCategory: { select: { name: true } } },
    });

    const updated = await tx.subCategory.update({
      where: { id },
      data: { clients: body.clients },
    });

    // Determine which clients are being added and removed in this call.
    const prevSet = new Set(existing.clients);
    const newClients = body.clients.filter((c) => !prevSet.has(c));
    const removedClients = existing.clients.filter((c) => !body.clients.includes(c));

    // Find work types whose parents include this sub-category.
    const linkedWorkTypes = await tx.workType.findMany({
      where: { parents: { has: existing.name } },
    });

    const generatedRules: Array<{
      id: number; keywords: string[]; category: string;
      subCategory: string | null; workType: string; sortOrder: number;
    }> = [];

    // Phase 3: delete InferenceRules for removed clients. The `keywords: { has }`
    // filter targets rules whose keyword array contains the removed client name,
    // scoped to this sub-category to avoid touching unrelated rules.
    for (const client of removedClients) {
      await tx.inferenceRule.deleteMany({
        where: {
          subCategory: existing.name,
          keywords: { has: client.toLowerCase() },
        },
      });
    }

    // For every new client × every linked work type, auto-create an
    // InferenceRule so the NLP parser can classify matching journal text.
    // subCategoryId + workTypeId are populated so future deletes cascade at DB level.
    for (const client of newClients) {
      for (const wt of linkedWorkTypes) {
        const rule = await tx.inferenceRule.create({
          data: {
            keywords: [client.toLowerCase(), existing.name.toLowerCase()],
            category: existing.mainCategory.name,
            subCategory: existing.name,
            workType: wt.name,
            sortOrder: 0,
            subCategoryId: id,
            workTypeId: wt.id,
          },
        });
        generatedRules.push(rule);
      }
    }

    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update-clients',
      entity: 'SubCategory',
      entityId: String(updated.id),
      payload: { clients: updated.clients, autoInferenceCount: generatedRules.length },
    });

    return { subCategory: updated, generatedRules };
  });

  res.json(result);
}

export async function deleteSubCategory(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    const existing = await tx.subCategory.findUniqueOrThrow({ where: { id }, select: { name: true } });

    // Prune this sub-category name from every WorkType that references it.
    // WorkType.parents is String[] (no FK), so stale names must be removed manually.
    // Leaving them causes work types to appear "pre-attached" if a new sub-category
    // is created later with the same name.
    const affectedWorkTypes = await tx.workType.findMany({
      where: { parents: { has: existing.name } },
    });

    for (const wt of affectedWorkTypes) {
      await tx.workType.update({
        where: { id: wt.id },
        data: { parents: wt.parents.filter((p) => p !== existing.name) },
      });
    }

    // Clean up pre-migration rules (subCategoryId = null) by string.
    // FK-linked rules cascade automatically via SubCategory → InferenceRule.
    await tx.inferenceRule.deleteMany({ where: { subCategory: existing.name, subCategoryId: null } });

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
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.workType.create({
      data: { name: sanitizeName(body.name), parents: body.parents },
    });

    const generatedRules: Array<{
      id: number; keywords: string[]; category: string;
      subCategory: string | null; workType: string; sortOrder: number;
    }> = [];

    for (const parentName of body.parents) {
      const rule = await createRuleForParent(tx, created.id, created.name, parentName);
      if (rule) generatedRules.push(rule);
    }

    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'create',
      entity: 'WorkType',
      entityId: String(created.id),
      payload: { name: created.name, parents: created.parents, autoInferenceCount: generatedRules.length },
    });

    return { workType: created, generatedRules };
  });
  res.status(201).json(result);
}

export async function renameWorkType(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, RenameSchema);
  const newName = sanitizeName(body.name);
  const wt = await prisma.$transaction(async (tx) => {
    const existing = await tx.workType.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const oldName = existing.name;

    const updated = await tx.workType.update({ where: { id }, data: { name: newName } });

    // Sync InferenceRule.workType and rebuild the tokenized keyword set.
    // Old tokens (full name + individual words) are removed; new tokens are
    // prepended. Non-work-type keywords (parent names, client codes) are kept.
    const oldTokens = new Set(tokenizeWorkTypeName(oldName));
    const newTokens = tokenizeWorkTypeName(newName);
    const affectedRules = await tx.inferenceRule.findMany({ where: { workType: oldName } });
    for (const rule of affectedRules) {
      await tx.inferenceRule.update({
        where: { id: rule.id },
        data: {
          workType: newName,
          keywords: [...newTokens, ...rule.keywords.filter((k) => !oldTokens.has(k))],
        },
      });
    }

    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update',
      entity: 'WorkType',
      entityId: String(updated.id),
      payload: { name: updated.name, renamedFrom: oldName },
    });
    return updated;
  });
  res.json(wt);
}

// ── Shared helper ───────────────────────────────────────────────────────────

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Resolve a parent name (SubCategory OR MainCategory) and create one inference rule. Returns null if the name matches neither. */
async function createRuleForParent(
  tx: TxClient,
  workTypeId: number,
  workTypeName: string,
  parentName: string,
) {
  const sub = await tx.subCategory.findFirst({
    where: { name: parentName },
    include: { mainCategory: { select: { name: true } } },
  });
  if (sub) {
    return tx.inferenceRule.create({
      data: {
        keywords: [...tokenizeWorkTypeName(workTypeName), parentName.toLowerCase()],
        category: sub.mainCategory.name,
        subCategory: parentName,
        workType: workTypeName,
        sortOrder: 0,
        subCategoryId: sub.id,
        workTypeId,
      },
    });
  }

  const main = await tx.mainCategory.findFirst({ where: { name: parentName } });
  if (!main) return null;

  return tx.inferenceRule.create({
    data: {
      keywords: [...tokenizeWorkTypeName(workTypeName), parentName.toLowerCase()],
      category: parentName,
      subCategory: null,
      workType: workTypeName,
      sortOrder: 0,
      workTypeId,
    },
  });
}

/** Delete auto-generated rules for a parent that was removed (handles both Sub and Main category parents). */
async function deleteRulesForRemovedParent(
  tx: TxClient,
  workTypeName: string,
  parentName: string,
) {
  await tx.inferenceRule.deleteMany({
    where: { workType: workTypeName, subCategory: parentName },
  });
  await tx.inferenceRule.deleteMany({
    where: { workType: workTypeName, category: parentName, subCategory: null },
  });
}

// ── Work types ───────────────────────────────────────────────────────────────

export async function setWorkTypeParents(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  const body = getValid(req, SetWorkTypeParentsSchema);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.workType.findUniqueOrThrow({ where: { id } });

    const updated = await tx.workType.update({
      where: { id },
      data: { parents: body.parents },
    });

    // Determine which sub-category parents are being newly added or removed.
    const prevSet = new Set(existing.parents);
    const newParents = body.parents.filter((p) => !prevSet.has(p));
    const removedParents = existing.parents.filter((p) => !body.parents.includes(p));

    const generatedRules: Array<{
      id: number; keywords: string[]; category: string;
      subCategory: string | null; workType: string; sortOrder: number;
    }> = [];

    for (const parentName of removedParents) {
      await deleteRulesForRemovedParent(tx, existing.name, parentName);
    }

    for (const parentName of newParents) {
      const rule = await createRuleForParent(tx, id, existing.name, parentName);
      if (rule) generatedRules.push(rule);
    }

    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'update-parents',
      entity: 'WorkType',
      entityId: String(updated.id),
      payload: { parents: updated.parents, autoInferenceCount: generatedRules.length },
    });

    return { workType: updated, generatedRules };
  });

  res.json(result);
}

export async function bulkUpdateWorkTypeParents(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, BulkUpdateWorkTypeParentsSchema);

  const generatedRules: Array<{
    id: number; keywords: string[]; category: string;
    subCategory: string | null; workType: string; sortOrder: number;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const { id, parents } of body.updates) {
      const existing = await tx.workType.findUniqueOrThrow({ where: { id } });

      await tx.workType.update({ where: { id }, data: { parents } });

      const prevSet = new Set(existing.parents);
      const newParents = parents.filter((p) => !prevSet.has(p));
      const removedParents = existing.parents.filter((p) => !parents.includes(p));

      for (const parentName of removedParents) {
        await deleteRulesForRemovedParent(tx, existing.name, parentName);
      }

      for (const parentName of newParents) {
        const rule = await createRuleForParent(tx, id, existing.name, parentName);
        if (rule) generatedRules.push(rule);
      }
    }

    await logAuditTx(tx, {
      userId: req.userId!,
      action: 'bulk-update-parents',
      entity: 'WorkType',
      entityId: 'bulk',
      payload: { count: body.updates.length, autoInferenceCount: generatedRules.length },
    });
  });

  res.json({ generatedRules });
}

export async function deleteWorkType(req: AuthRequest, res: Response): Promise<void> {
  const { id } = getValid(req, NumericIdParamSchema, 'params');
  await prisma.$transaction(async (tx) => {
    // Phase 1: clean up pre-migration rules (workTypeId = null) by string.
    // Rules with workTypeId populated cascade automatically via the FK.
    const existing = await tx.workType.findUniqueOrThrow({ where: { id }, select: { name: true } });
    await tx.inferenceRule.deleteMany({ where: { workType: existing.name, workTypeId: null } });

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
