import { type Prisma, type PrismaClient } from "../../../generated/prisma";
import { type AuditEntry, toAuditLogRow } from "~/server/domain/audit/entry";

/** The subset of the client a mutation needs; satisfied by a transaction. */
export type AuditTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Runs a mutation and records it, both inside one transaction.
 *
 * Same transaction, not two writes: an audit row for a mutation that rolled
 * back is a lie, and a mutation whose audit row failed to write is exactly the
 * silent gap INV-1 and INV-7 exist to close. Rolling back one rolls back both.
 *
 * The mutation receives the transaction and must use it — writing through the
 * outer client would escape the transaction and reintroduce the gap.
 */
export async function withAudit<T>(
  db: PrismaClient,
  entry: AuditEntry,
  mutate: (tx: AuditTransaction) => Promise<T>,
): Promise<T> {
  // Built before the transaction opens so an invalid entry fails without
  // taking a connection or leaving a half-open transaction behind.
  const row = toAuditLogRow(entry);

  return db.$transaction(async (tx) => {
    const result = await mutate(tx);

    await tx.auditLog.create({
      data: {
        organizationId: row.organizationId,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before as Prisma.InputJsonValue,
        after: row.after as Prisma.InputJsonValue,
        ip: row.ip,
        userAgent: row.userAgent,
        agentModel: row.agentModel,
        agentPromptVersion: row.agentPromptVersion,
      },
    });

    return result;
  });
}
