/**
 * POST /api/migrate
 *
 * One-time endpoint: accepts a localStorage blob exported from the frontend
 * and seeds the database. Idempotent — safe to call multiple times; existing
 * rows are upserted rather than duplicated.
 *
 * Protected by the MIGRATE_SECRET env var (fail-closed). The endpoint is
 * DISABLED unless MIGRATE_SECRET is set, and callers must pass the matching
 * value as the `x-migrate-secret` request header. A missing env var no longer
 * opens the endpoint — it refuses every request with 403.
 *
 * Expected request body:
 * {
 *   employees?:     Employee[]            // { id, firstName, lastName, email, password, role, team, managerId, jobTitle }
 *   allocations?:   AllocationRecord[]    // frontend shape with `streams: WorkStreamData[]`
 *   journal?:       JournalEntry[]        // { employeeId, date, content, blocks?, updatedAt }
 *   clientsConfig?: ClientsConfigBundleV3 // { teams, clients, mainCategories, subCategories, workTypes, inferenceRules }
 * }
 *
 * Response: { seeded: { employees, allocations, journalEntries, teams, clients, mainCategories, subCategories, workTypes, inferenceRules } }
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';
import type { AllocationStatus } from '../generated/prisma/enums.js';

const router = Router();

// Map frontend status strings to DB enum values.
const STATUS_MAP: Record<string, AllocationStatus> = {
  Draft: 'Draft',
  'Pending Review': 'PendingReview',
  Approved: 'Approved',
  'Needs Revision': 'NeedsRevision',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/', async (req: any, res: any, next: any) => {
  try {
    // ── Auth (fail-closed) ────────────────────────────────────────────────
    // The endpoint is off unless MIGRATE_SECRET is configured AND the caller
    // presents the matching header. Previously a missing env var left the
    // route wide open (unauthenticated user/allocation writes); it now refuses.
    const secret = process.env.MIGRATE_SECRET;
    if (!secret || req.headers['x-migrate-secret'] !== secret) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const body = req.body ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employees: any[] = Array.isArray(body.employees) ? body.employees : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allocations: any[] = Array.isArray(body.allocations) ? body.allocations : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const journal: any[] = Array.isArray(body.journal) ? body.journal : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = body.clientsConfig ?? null;

    const seeded = {
      employees: 0,
      allocations: 0,
      journalEntries: 0,
      teams: 0,
      clients: 0,
      mainCategories: 0,
      subCategories: 0,
      workTypes: 0,
      inferenceRules: 0,
    };

    // ── 1. Employees ────────────────────────────────────────────────────────
    // Hash plain passwords from localStorage. If no password provided (rare),
    // generate a random one — the user will authenticate via OTP anyway.
    for (const emp of employees) {
      if (!emp?.id || !emp?.email) continue;
      const raw: string = emp.password || randomUUID();
      const passwordHash = await bcrypt.hash(raw, 10);

      // Roles import: accept either the new `roles: string[]` shape from
      // a post-Phase-N localStorage export, or the legacy `role: string`
      // shape from older exports. Wrap legacy single-role into a one-
      // element array; default to ['Employee'] if neither is present.
      let rolesPayload: string[];
      if (Array.isArray(emp.roles) && emp.roles.length > 0) {
        rolesPayload = Array.from(new Set(emp.roles.filter((r: unknown) => typeof r === 'string')));
      } else if (typeof emp.role === 'string') {
        rolesPayload = [emp.role];
      } else {
        rolesPayload = ['Employee'];
      }

      await prisma.user.upsert({
        where: { id: emp.id },
        create: {
          id: emp.id,
          firstName: emp.firstName ?? '',
          lastName: emp.lastName ?? '',
          email: emp.email,
          passwordHash,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          roles: rolesPayload as any,
          team: emp.team ?? '',
          managerId: emp.managerId ?? null,
          jobTitle: emp.jobTitle ?? '',
        },
        update: {
          firstName: emp.firstName ?? '',
          lastName: emp.lastName ?? '',
          email: emp.email,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          roles: { set: rolesPayload as any },
          team: emp.team ?? '',
          managerId: emp.managerId ?? null,
          jobTitle: emp.jobTitle ?? '',
          // Preserve password — don't overwrite OTP-set passwords with old
          // plain-text ones. On the very first import this is a no-op anyway.
        },
      });
      seeded.employees++;
    }

    // ── 2. ClientsConfig ────────────────────────────────────────────────────
    if (config) {
      const teamNames: string[] = Array.isArray(config.teams) ? config.teams : [];
      for (let i = 0; i < teamNames.length; i++) {
        const name = teamNames[i];
        if (typeof name !== 'string' || !name) continue;
        await prisma.team.upsert({
          where: { name },
          create: { name, sortOrder: i },
          update: { sortOrder: i },
        });
        seeded.teams++;
      }

      const clientNames: string[] = Array.isArray(config.clients) ? config.clients : [];
      for (let i = 0; i < clientNames.length; i++) {
        const name = clientNames[i];
        if (typeof name !== 'string' || !name) continue;
        await prisma.client.upsert({
          where: { name },
          create: { name, sortOrder: i },
          update: { sortOrder: i },
        });
        seeded.clients++;
      }

      const mainCatNames: string[] = Array.isArray(config.mainCategories)
        ? config.mainCategories
        : [];
      for (let i = 0; i < mainCatNames.length; i++) {
        const name = mainCatNames[i];
        if (typeof name !== 'string' || !name) continue;
        await prisma.mainCategory.upsert({
          where: { name },
          create: { name, sortOrder: i },
          update: { sortOrder: i },
        });
        seeded.mainCategories++;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subCats: any[] = Array.isArray(config.subCategories) ? config.subCategories : [];
      for (let i = 0; i < subCats.length; i++) {
        const sub = subCats[i];
        if (!sub?.name || !sub?.parentMainCategory) continue;
        const main = await prisma.mainCategory.findUnique({
          where: { name: sub.parentMainCategory },
        });
        if (!main) continue;
        await prisma.subCategory.upsert({
          where: { name: sub.name },
          create: {
            name: sub.name,
            mainCategoryId: main.id,
            clients: Array.isArray(sub.clients) ? sub.clients : [],
            sortOrder: i,
          },
          update: {
            mainCategoryId: main.id,
            clients: Array.isArray(sub.clients) ? sub.clients : [],
            sortOrder: i,
          },
        });
        seeded.subCategories++;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const workTypeList: any[] = Array.isArray(config.workTypes) ? config.workTypes : [];
      for (const wt of workTypeList) {
        if (!wt?.name) continue;
        await prisma.workType.upsert({
          where: { name: wt.name },
          create: { name: wt.name, parents: Array.isArray(wt.parents) ? wt.parents : [] },
          update: { parents: Array.isArray(wt.parents) ? wt.parents : [] },
        });
        seeded.workTypes++;
      }

      // Inference rules: bulk replace (delete all existing, recreate from blob).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rules: any[] = Array.isArray(config.inferenceRules) ? config.inferenceRules : [];
      if (rules.length > 0) {
        await prisma.inferenceRule.deleteMany();
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          if (!rule?.category || !rule?.workType) continue;
          await prisma.inferenceRule.create({
            data: {
              keywords: Array.isArray(rule.keywords) ? rule.keywords : [],
              category: rule.category,
              subCategory: rule.subCategory ?? null,
              workType: rule.workType,
              sortOrder: i,
            },
          });
          seeded.inferenceRules++;
        }
      }
    }

    // ── 3. Journal ──────────────────────────────────────────────────────────
    for (const entry of journal) {
      if (!entry?.employeeId || !entry?.date || typeof entry.content !== 'string') continue;
      await prisma.journalEntry.upsert({
        where: { employeeId_date: { employeeId: entry.employeeId, date: entry.date } },
        create: {
          employeeId: entry.employeeId,
          date: entry.date,
          content: entry.content,
          blocks: entry.blocks ?? undefined,
        },
        update: {
          content: entry.content,
          blocks: entry.blocks ?? undefined,
        },
      });
      seeded.journalEntries++;
    }

    // ── 4. Allocations ──────────────────────────────────────────────────────
    // Stream activities are deleted and recreated on each upsert so ordering
    // is always correct and stale activities from renamed/removed streams
    // don't accumulate.
    for (const rec of allocations) {
      if (!rec?.id || !rec?.employeeId) continue;

      const dbStatus: AllocationStatus = STATUS_MAP[rec.status as string] ?? 'Draft';

      // Remove stale activities first (re-inserted below with correct ordering).
      await prisma.allocationActivity.deleteMany({ where: { recordId: rec.id } });

      await prisma.allocationRecord.upsert({
        where: { id: rec.id },
        create: {
          id: rec.id,
          employeeId: rec.employeeId,
          team: rec.team ?? '',
          managerId: rec.managerId || null,
          month: rec.month ?? '',
          year: rec.year ?? '',
          monthIndex: rec.monthIndex ?? 0,
          status: dbStatus,
          submittedAt: rec.submittedAt ? new Date(rec.submittedAt as string) : null,
          reviewedAt: rec.reviewedAt ? new Date(rec.reviewedAt as string) : null,
          feedback: rec.feedback ?? null,
          lastEditedByUserId: rec.lastEditedBy?.userId ?? null,
          lastEditedByUserName: rec.lastEditedBy?.userName ?? null,
          lastEditedAt: rec.lastEditedBy?.at ? new Date(rec.lastEditedBy.at as string) : null,
        },
        update: {
          team: rec.team ?? '',
          managerId: rec.managerId || null,
          status: dbStatus,
          submittedAt: rec.submittedAt ? new Date(rec.submittedAt as string) : null,
          reviewedAt: rec.reviewedAt ? new Date(rec.reviewedAt as string) : null,
          feedback: rec.feedback ?? null,
          lastEditedByUserId: rec.lastEditedBy?.userId ?? null,
          lastEditedByUserName: rec.lastEditedBy?.userName ?? null,
          lastEditedAt: rec.lastEditedBy?.at ? new Date(rec.lastEditedBy.at as string) : null,
        },
      });

      // Recreate activities from the streams array.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streams: any[] = Array.isArray(rec.streams) ? rec.streams : [];
      for (let si = 0; si < streams.length; si++) {
        const stream = streams[si];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const activities: any[] = Array.isArray(stream?.activities) ? stream.activities : [];
        for (let ai = 0; ai < activities.length; ai++) {
          const act = activities[ai];
          if (!act?.id) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const flag: any = rec.flags?.[act.id as string];
          await prisma.allocationActivity.create({
            data: {
              id: act.id as string,
              recordId: rec.id as string,
              streamCategory: (stream.category as string) ?? '',
              subCategory: (act.subCategory as string | null) ?? null,
              workType: (act.workType as string) ?? '',
              client: (act.client as string) ?? '',
              description: (act.description as string) ?? '',
              percentage: (act.percentage as number) ?? 0,
              streamOrder: si,
              activityOrder: ai,
              flagReason: flag?.reason ?? null,
              flaggedAt: flag?.flaggedAt ? new Date(flag.flaggedAt as string) : null,
            },
          });
        }
      }
      seeded.allocations++;
    }

    res.json({ seeded });
  } catch (err) {
    next(err);
  }
});

export default router;
