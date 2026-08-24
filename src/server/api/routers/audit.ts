import { z } from "zod";

import { createTRPCRouter, roleProcedure } from "~/server/api/trpc";

const auditActorType = z.enum(["USER", "AGENT", "SYSTEM"]);

const auditEntryOutput = z.object({
  id: z.string(),
  actorType: auditActorType,
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  agentModel: z.string().nullable(),
  agentPromptVersion: z.string().nullable(),
  createdAt: z.date(),
});

const listByEntityOutput = z.object({
  entries: z.array(auditEntryOutput),
  nextCursor: z.string().nullable(),
});

/**
 * Read-only by construction: the table is append-only in the database, and
 * there is deliberately no mutation here. Entries are written through
 * `withAudit()` alongside the mutation they describe, never on their own.
 *
 * `roleProcedure("FINANCE")` admits FINANCE and OWNER — OWNER passes every
 * role check — which is exactly the readership the audit log is scoped to.
 */
export const auditRouter = createTRPCRouter({
  listByEntity: roleProcedure("FINANCE")
    .input(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().nullish(),
      }),
    )
    .output(listByEntityOutput)
    .query(async ({ ctx, input }) => {
      // One extra row tells us whether another page exists without a count.
      const rows = await ctx.db.auditLog.findMany({
        where: {
          entityType: input.entityType,
          entityId: input.entityId,
        },
        select: {
          id: true,
          actorType: true,
          actorId: true,
          action: true,
          entityType: true,
          entityId: true,
          before: true,
          after: true,
          ip: true,
          userAgent: true,
          agentModel: true,
          agentPromptVersion: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      const entries = rows.slice(0, input.limit);

      return {
        entries,
        nextCursor:
          rows.length > input.limit ? (entries.at(-1)?.id ?? null) : null,
      };
    }),
});
