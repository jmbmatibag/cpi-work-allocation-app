import { prisma } from './prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export type AuditInput = {
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  payload?: unknown;
};

// Standalone variant: opens its own connection. Use when the mutation is a
// single Prisma call and a separate audit write is acceptable.
export async function logAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      payload: (input.payload as Prisma.InputJsonValue) ?? undefined,
    },
  });
}

// Transactional variant: pass the tx client so the audit row is atomic with
// the mutation. Prefer this whenever you're already inside $transaction.
export function logAuditTx(
  tx: Prisma.TransactionClient,
  input: AuditInput
): Promise<unknown> {
  return tx.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      payload: (input.payload as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
