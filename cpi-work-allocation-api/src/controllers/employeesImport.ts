import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logAuditTx } from '../lib/audit.js';
import {
  sendWelcomeEmail,
  PASSWORD_SETUP_TTL_MS,
  EMAIL_BATCH_SIZE,
  EMAIL_BATCH_DELAY_MS,
} from '../lib/mailer.js';
import { processInBatches } from '../lib/batch.js';
import type { AuthRequest } from '../middleware/auth.js';
import { primaryRole, type UserRole } from 'cpi-work-allocation-shared';
import {
  analyzeImportRows,
  nameKey,
  type AnalyzedRow,
  type RawImportRow,
  type SupervisorResolution,
} from '../lib/employeeImport.js';

// ---------------------------------------------------------------------------
// Job store
//
// The progress bar streams over an EventSource (GET, no body), so the
// analyzed plan can't ride along on the execute request. Instead /analyze
// stashes the prioritized plan here under a one-time jobId and returns it;
// the client passes the jobId to /execute, which streams the run.
//
// In-memory is the right call for the single-box EC2 deployment — no shared
// state across processes to worry about. Jobs are swept after 30 minutes so
// an abandoned analysis doesn't pin memory.
// ---------------------------------------------------------------------------

interface ImportJob {
  rows: AnalyzedRow[];
  createdBy: string;
  createdAt: number;
}

const jobs = new Map<string, ImportJob>();
const JOB_TTL_MS = 30 * 60 * 1000;

function sweepJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Id generation — mirrors controllers/employees.ts::generateEmployeeId but
// works against an in-memory, growing set so a whole batch gets unique,
// monotonic ids without re-querying the DB per row.
// ---------------------------------------------------------------------------

const PREFIX_BY_ROLE: Record<UserRole, string> = {
  Employee: 'EMP',
  Manager: 'MGR',
  Finance: 'FIN',
  Admin: 'ADM',
};

function nextId(roles: UserRole[], existingIds: Set<string>): string {
  const prefix = PREFIX_BY_ROLE[primaryRole(roles)];
  let max = 0;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const n = parseInt(id.slice(prefix.length), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  const id = `${prefix}${String(max + 1).padStart(3, '0')}`;
  existingIds.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// POST /api/employees/import/analyze   (Admin only)
//
// Pre-flight: read-only. Returns a one-time jobId plus a prioritized plan of
// what WOULD be created, which rows are invalid (with reasons), and how many
// welcome emails the execute phase would send. Creates nothing.
// ---------------------------------------------------------------------------

const AnalyzeBody = z.object({
  rows: z.array(z.record(z.string(), z.string())).min(1).max(1000),
});

export async function analyzeImport(req: AuthRequest, res: Response): Promise<void> {
  const parsed = AnalyzeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Expected a non-empty rows[] array of CSV records.',
    });
    return;
  }

  const directory = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true, roles: true },
  });

  const analysis = analyzeImportRows(parsed.data.rows as RawImportRow[], directory);

  sweepJobs();
  const jobId = randomBytes(16).toString('hex');
  jobs.set(jobId, {
    rows: analysis.rows,
    createdBy: req.userId!,
    createdAt: Date.now(),
  });

  res.json({ jobId, ...analysis });
}

// ---------------------------------------------------------------------------
// GET /api/employees/import/execute?jobId=..&sendEmail=true   (Admin only)
//
// Server-Sent Events. Streams `progress` events as rows are processed and a
// final `complete` event with the full metrics. Two-pass:
//   Pass 1 — create employees from the prioritized plan (managerId null)
//   Pass 2 — resolve supervisor names -> ids and link managerId
//   Emails — fired with Promise.allSettled so one bounce never aborts the run
// ---------------------------------------------------------------------------

const ExecuteQuery = z.object({
  jobId: z.string().min(1),
  sendEmail: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'), // default: send
});

interface CreatedRecord {
  id: string;
  email: string;
  name: string;
  setupToken: string;
  supervisorKey: string | null;
  supervisorResolution: SupervisorResolution;
}

export async function executeImport(req: AuthRequest, res: Response): Promise<void> {
  const parsed = ExecuteQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Missing or invalid jobId.' });
    return;
  }
  const { jobId, sendEmail } = parsed.data;

  const job = jobs.get(jobId);
  // Reject BEFORE switching to the event-stream so EventSource sees a clean
  // connection error rather than a half-open stream.
  if (!job) {
    res.status(410).json({ error: 'JOB_EXPIRED', message: 'Import session expired. Re-analyze the file.' });
    return;
  }
  if (job.createdBy !== req.userId) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  // Single-use: claim the job now so a refresh can't double-import.
  jobs.delete(jobId);

  // --- open the SSE stream ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable Nginx proxy buffering so events flush immediately in prod.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  const send = (event: string, data: unknown): void => {
    if (aborted || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const creates = job.rows.filter((r) => r.status === 'create' && r.mapped);

    // Snapshot the directory once: existing ids (for id generation) and a
    // name-key -> id map (for resolving supervisors that already exist).
    const directory = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true },
    });
    const existingIds = new Set(directory.map((u) => u.id));
    const dirNameKeyToId = new Map<string, string>();
    for (const u of directory) {
      const k = nameKey(`${u.firstName} ${u.lastName}`);
      if (k) dirNameKeyToId.set(k, u.id);
    }

    const total = creates.length;
    const created: CreatedRecord[] = [];
    const failed: { name: string; email: string; reason: string }[] = [];
    const createdNameKeyToId = new Map<string, string>();

    // ----- Pass 1: create -----
    for (let i = 0; i < creates.length; i++) {
      if (aborted) return;
      const row = creates[i]!;
      const m = row.mapped!;
      const name = `${m.firstName} ${m.lastName}`.trim();

      send('progress', {
        phase: 'create',
        processed: i,
        total,
        message: `Creating ${name}…`,
      });

      try {
        const id = nextId(m.roles, existingIds);
        const setupToken = randomBytes(32).toString('base64url');
        const setupExpiresAt = new Date(Date.now() + PASSWORD_SETUP_TTL_MS);

        await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: {
              id,
              passwordHash: null,
              passwordSetupToken: setupToken,
              passwordSetupExpiresAt: setupExpiresAt,
              firstName: m.firstName,
              lastName: m.lastName,
              email: m.email,
              roles: m.roles,
              team: m.team,
              jobTitle: m.jobTitle,
              managerId: null, // linked in pass 2
            },
          });
          await logAuditTx(tx, {
            userId: job.createdBy,
            action: 'create',
            entity: 'User',
            entityId: u.id,
            payload: {
              email: u.email,
              roles: [...u.roles],
              team: u.team,
              jobTitle: u.jobTitle,
              passwordSetupPending: true,
              bulkImport: true,
            },
          });
        });

        const selfKey = nameKey(name);
        if (selfKey) createdNameKeyToId.set(selfKey, id);
        created.push({
          id,
          email: m.email,
          name,
          setupToken,
          supervisorKey: m.supervisorKey,
          supervisorResolution: m.supervisorResolution,
        });
      } catch (err) {
        // A row failing (e.g. an email that raced in between analyze and
        // execute) must not abort the batch.
        failed.push({
          name,
          email: m.email,
          reason: err instanceof Error ? err.message : 'Failed to create record.',
        });
      }
    }

    // ----- Pass 2: link managers -----
    let linked = 0;
    for (let i = 0; i < created.length; i++) {
      if (aborted) return;
      const c = created[i]!;
      if (!c.supervisorKey || c.supervisorResolution === 'not_found') continue;

      const managerId =
        createdNameKeyToId.get(c.supervisorKey) ?? dirNameKeyToId.get(c.supervisorKey);
      if (!managerId || managerId === c.id) continue;

      send('progress', {
        phase: 'link',
        processed: i,
        total: created.length,
        message: `Linking ${c.name} to their manager…`,
      });

      try {
        await prisma.user.update({ where: { id: c.id }, data: { managerId } });
        linked++;
      } catch {
        // Non-fatal: the employee still exists, just without a manager link.
      }
    }

    // ----- Emails: safe fan-out, never aborts the run -----
    let emailsSent = 0;
    if (sendEmail && created.length > 0) {
      send('progress', {
        phase: 'email',
        processed: 0,
        total: created.length,
        message: `Sending ${created.length} welcome email${created.length === 1 ? '' : 's'}…`,
      });
      // Throttled fan-out: blasting all sends at once via Promise.allSettled
      // opened one SMTP connection per employee and tripped Office 365's
      // "432 4.3.2 Concurrent connections limit exceeded". Sending in small
      // chunks with a gap between them stays under the ceiling; one bounce
      // still never aborts the run. Progress ticks per chunk.
      const results = await processInBatches(
        created,
        (c) => sendWelcomeEmail(c.email, c.name, c.setupToken),
        {
          batchSize: EMAIL_BATCH_SIZE,
          delayMs: EMAIL_BATCH_DELAY_MS,
          onChunk: (processed, total) => {
            send('progress', {
              phase: 'email',
              processed,
              total,
              message: `Sent ${processed} of ${total} welcome email${total === 1 ? '' : 's'}…`,
            });
          },
        },
      );
      emailsSent = results.filter((r) => r.status === 'fulfilled').length;
      const bounced = results.length - emailsSent;
      if (bounced > 0) {
        console.error(`[employeesImport.execute] ${bounced} welcome email(s) failed to send.`);
      }
    }

    send('complete', {
      imported: created.length,
      linked,
      emailsSent,
      failed,
      skippedExisting: job.rows.filter((r) => r.status === 'skip_existing').length,
      invalid: job.rows.filter((r) => r.status === 'error').length,
      total: job.rows.length,
    });
    res.end();
  } catch (err) {
    console.error('[employeesImport.execute] fatal:', (err as Error).message);
    send('failed', { message: 'The import stopped unexpectedly. Some rows may have been created.' });
    res.end();
  }
}
