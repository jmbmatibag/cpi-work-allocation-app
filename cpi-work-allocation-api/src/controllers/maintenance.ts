import type { Request, Response } from 'express';
import {
  UpdateMaintenanceSchema,
  type MaintenanceStatus,
} from 'cpi-work-allocation-shared';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit.js';
import type { AuthRequest } from '../middleware/auth.js';
import { getValid } from '../middleware/validate.js';

// The singleton row's primary key. There is exactly one MaintenanceSetting
// row for the whole deployment — see the model comment in schema.prisma.
const SINGLETON_ID = 1;

// Mirrors the column defaults. Used only if the seeded row is somehow missing
// (a DB restored from a pre-migration dump), so a read never 500s and the app
// fails OPEN — an unreachable maintenance table must not lock everyone out.
const FALLBACK: MaintenanceStatus = {
  enabled: false,
  title: 'Scheduled Maintenance',
  message:
    'The CPI Work Allocation app is temporarily unavailable while we perform scheduled maintenance. Please check back shortly.',
  startsAt: null,
  endsAt: null,
  updatedAt: new Date(0).toISOString(),
  updatedByName: null,
};

type MaintenanceRow = {
  enabled: boolean;
  title: string;
  message: string;
  startsAt: Date | null;
  endsAt: Date | null;
  updatedAt: Date;
  updatedByName: string | null;
};

/** DB row → wire DTO. Dates become ISO strings; internal ids stay internal. */
function toDto(row: MaintenanceRow): MaintenanceStatus {
  return {
    enabled: row.enabled,
    title: row.title,
    message: row.message,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

/**
 * GET /api/maintenance — PUBLIC, no auth.
 *
 * Must be reachable by a signed-out browser: the announcement has to render
 * for someone who never logs in, and the login screen itself needs to know
 * whether to show the maintenance notice. Nothing sensitive is exposed —
 * just the operator-authored copy.
 */
export async function getStatus(_req: Request, res: Response): Promise<void> {
  try {
    const row = await prisma.maintenanceSetting.findUnique({
      where: { id: SINGLETON_ID },
    });
    res.json(row ? toDto(row) : FALLBACK);
  } catch (err) {
    // Fail OPEN. If the DB is unreachable the app is already broken; taking
    // the whole UI down with a maintenance screen would only hide the real
    // error from whoever is trying to diagnose it.
    console.warn('[maintenance] status read failed:', (err as Error).message);
    res.json(FALLBACK);
  }
}

/**
 * PUT /api/maintenance — Admin only.
 *
 * Partial patch: `enabled` is required, everything else keeps its stored
 * value when omitted. Upserts so a missing singleton row self-heals.
 */
export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  const body = getValid(req, UpdateMaintenanceSchema);

  const actor = req.userId
    ? await prisma.user.findUnique({
        where: { id: req.userId },
        select: { firstName: true, lastName: true },
      })
    : null;
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : null;

  // Only spread fields the caller actually sent — `undefined` would overwrite
  // with null on the create branch and is a no-op Prisma update otherwise.
  const patch = {
    enabled: body.enabled,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.message !== undefined ? { message: body.message } : {}),
    ...(body.startsAt !== undefined
      ? { startsAt: body.startsAt ? new Date(body.startsAt) : null }
      : {}),
    ...(body.endsAt !== undefined
      ? { endsAt: body.endsAt ? new Date(body.endsAt) : null }
      : {}),
    updatedById: req.userId ?? null,
    updatedByName: actorName,
  };

  const row = await prisma.maintenanceSetting.upsert({
    where: { id: SINGLETON_ID },
    update: patch,
    create: { id: SINGLETON_ID, ...patch },
  });

  await logAudit({
    userId: req.userId ?? null,
    action: 'maintenance-update',
    entity: 'MaintenanceSetting',
    entityId: String(SINGLETON_ID),
    payload: {
      enabled: row.enabled,
      title: row.title,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
    },
  }).catch((e) => {
    console.warn('[maintenance] audit stamp failed:', (e as Error).message);
  });

  console.log(
    `[maintenance] mode ${row.enabled ? 'ENABLED' : 'DISABLED'} by ${actorName ?? 'unknown'}`,
  );

  res.json(toDto(row));
}
