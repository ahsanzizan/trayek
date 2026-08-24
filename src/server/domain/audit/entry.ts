/**
 * Who performed a mutation. A discriminated union rather than a flat record,
 * because the three actor kinds carry genuinely different evidence:
 *
 * - USER actions need the request context that proves who approved what
 *   (INV-1 records actor id, timestamp, and IP).
 * - AGENT actions need the model and prompt version, or the action cannot be
 *   reproduced later. Making them required fields means an agent action that
 *   omits them does not compile.
 * - SYSTEM actions have no identity to record.
 */
export type AuditActor =
  | {
      type: "USER";
      id: string;
      ip?: string;
      userAgent?: string;
    }
  | {
      type: "AGENT";
      id: string;
      model: string;
      promptVersion: string;
    }
  | { type: "SYSTEM" };

export interface AuditEntry {
  organizationId: string;
  actor: AuditActor;
  /** Stable verb naming the mutation, e.g. `INVOICE_APPROVED`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Shape persisted to the `AuditLog` table, flattened from the entry. */
export interface AuditLogRow {
  organizationId: string;
  actorType: "USER" | "AGENT" | "SYSTEM";
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  agentModel: string | null;
  agentPromptVersion: string | null;
}

export class InvalidAuditEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAuditEntryError";
  }
}

function assertPresent(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new InvalidAuditEntryError(`${field} cannot be empty`);
  }

  return value;
}

/**
 * Flattens an entry for persistence. Pure — the caller owns the database.
 *
 * An audit row that cannot identify its subject is worse than useless, so the
 * identifying fields are checked here rather than relying on a NOT NULL
 * constraint to reject an empty string, which it would happily accept.
 */
export function toAuditLogRow(entry: AuditEntry): AuditLogRow {
  assertPresent(entry.organizationId, "organizationId");
  assertPresent(entry.action, "action");
  assertPresent(entry.entityType, "entityType");
  assertPresent(entry.entityId, "entityId");

  const base = {
    organizationId: entry.organizationId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  };

  if (entry.actor.type === "USER") {
    return {
      ...base,
      actorType: "USER",
      actorId: assertPresent(entry.actor.id, "actor.id"),
      ip: entry.actor.ip ?? null,
      userAgent: entry.actor.userAgent ?? null,
      agentModel: null,
      agentPromptVersion: null,
    };
  }

  if (entry.actor.type === "AGENT") {
    return {
      ...base,
      actorType: "AGENT",
      actorId: assertPresent(entry.actor.id, "actor.id"),
      ip: null,
      userAgent: null,
      agentModel: assertPresent(entry.actor.model, "actor.model"),
      agentPromptVersion: assertPresent(
        entry.actor.promptVersion,
        "actor.promptVersion",
      ),
    };
  }

  return {
    ...base,
    actorType: "SYSTEM",
    actorId: null,
    ip: null,
    userAgent: null,
    agentModel: null,
    agentPromptVersion: null,
  };
}
