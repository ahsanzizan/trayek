import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  orgProcedure,
  roleProcedure,
} from "~/server/api/trpc";
import { withAudit } from "~/server/audit/with-audit";
import { diffRequirementRules } from "~/server/domain/shipper/requirement-diff";
import {
  parseRequirementRules,
  requirementRulesSchema,
} from "~/server/domain/shipper/requirement-rules";

/**
 * Shippers and their versioned requirement profiles (TRK-010).
 *
 * Managing a shipper is an admin action, so the mutations sit behind
 * `roleProcedure("ADMIN")`, which admits ADMIN and OWNER. Reads are open to any
 * member: a dispatcher needs to see what a shipper requires without being able
 * to change it.
 *
 * Every mutation runs through `withAudit()`. A requirement change silently
 * moving a due date is exactly the kind of edit that has to stay attributable
 * months later.
 */

const shipperDetails = {
  name: z.string().min(1).max(200),
  npwp: z.string().max(30).nullable().default(null),
  financeContactName: z.string().max(200).nullable().default(null),
  financeContactEmail: z.string().email().max(200).nullable().default(null),
  financeContactPhone: z.string().max(30).nullable().default(null),
  address: z.string().max(500).nullable().default(null),
};

const shipperOutput = z.object({
  id: z.string(),
  name: z.string(),
  npwp: z.string().nullable(),
  financeContactName: z.string().nullable(),
  financeContactEmail: z.string().nullable(),
  financeContactPhone: z.string().nullable(),
  address: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const profileVersionOutput = z.object({
  id: z.string(),
  version: z.number().int(),
  rules: requirementRulesSchema,
  changeNote: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.date(),
  supersededAt: z.date().nullable(),
});

const ruleChangeOutput = z.object({
  path: z.string(),
  kind: z.enum(["ADDED", "REMOVED", "CHANGED"]),
  before: z.unknown(),
  after: z.unknown(),
});

const shipperSelect = {
  id: true,
  name: true,
  npwp: true,
  financeContactName: true,
  financeContactEmail: true,
  financeContactPhone: true,
  address: true,
  createdAt: true,
  updatedAt: true,
} as const;

const profileSelect = {
  id: true,
  version: true,
  rules: true,
  changeNote: true,
  createdById: true,
  createdAt: true,
  supersededAt: true,
} as const;

type StoredProfile = {
  id: string;
  version: number;
  rules: unknown;
  changeNote: string | null;
  createdById: string | null;
  createdAt: Date;
  supersededAt: Date | null;
};

/**
 * Parses the stored rule JSON on the way out. A row written before a change to
 * the rule vocabulary fails here, rather than reaching a client as a shape
 * nothing can render.
 */
function toProfileVersion(profile: StoredProfile) {
  return { ...profile, rules: parseRequirementRules(profile.rules) };
}

export const shipperRouter = createTRPCRouter({
  list: orgProcedure
    .input(z.object({}).default({}))
    .output(
      z.array(
        shipperOutput.extend({
          activeProfileVersion: z.number().int().nullable(),
        }),
      ),
    )
    .query(async ({ ctx }) => {
      const shippers = await ctx.db.shipper.findMany({
        select: {
          ...shipperSelect,
          requirementProfiles: {
            where: { supersededAt: null },
            select: { version: true },
          },
        },
        orderBy: { name: "asc" },
      });

      return shippers.map(({ requirementProfiles, ...shipper }) => ({
        ...shipper,
        activeProfileVersion: requirementProfiles[0]?.version ?? null,
      }));
    }),

  byId: orgProcedure
    .input(z.object({ shipperId: z.string().min(1) }))
    .output(
      shipperOutput.extend({
        activeProfile: profileVersionOutput.nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const shipper = await ctx.db.shipper.findFirst({
        where: { id: input.shipperId },
        select: {
          ...shipperSelect,
          requirementProfiles: {
            where: { supersededAt: null },
            select: profileSelect,
          },
        },
      });

      // A shipper in another organization is absent, not forbidden. FORBIDDEN
      // would confirm the id exists somewhere.
      if (!shipper) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { requirementProfiles, ...details } = shipper;
      const active = requirementProfiles[0];

      return {
        ...details,
        activeProfile: active ? toProfileVersion(active) : null,
      };
    }),

  listProfileVersions: orgProcedure
    .input(z.object({ shipperId: z.string().min(1) }))
    .output(z.array(profileVersionOutput))
    .query(async ({ ctx, input }) => {
      const shipper = await ctx.db.shipper.findFirst({
        where: { id: input.shipperId },
        select: { id: true },
      });

      if (!shipper) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const versions = await ctx.db.requirementProfile.findMany({
        where: { shipperId: input.shipperId },
        select: profileSelect,
        orderBy: { version: "desc" },
      });

      return versions.map(toProfileVersion);
    }),

  diffProfileVersions: orgProcedure
    .input(
      z.object({
        shipperId: z.string().min(1),
        fromVersion: z.number().int().min(1),
        toVersion: z.number().int().min(1),
      }),
    )
    .output(z.array(ruleChangeOutput))
    .query(async ({ ctx, input }) => {
      const versions = await ctx.db.requirementProfile.findMany({
        where: {
          shipperId: input.shipperId,
          version: { in: [input.fromVersion, input.toVersion] },
        },
        select: profileSelect,
      });

      const from = versions.find(
        (version) => version.version === input.fromVersion,
      );
      const to = versions.find(
        (version) => version.version === input.toVersion,
      );

      if (!from || !to) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return diffRequirementRules(
        parseRequirementRules(from.rules),
        parseRequirementRules(to.rules),
      );
    }),

  create: roleProcedure("ADMIN")
    .input(z.object(shipperDetails))
    .output(shipperOutput)
    .mutation(async ({ ctx, input }) => {
      return withAudit(
        ctx.db,
        // Result-derived, so the entry names the row that was actually
        // written rather than a placeholder.
        (created) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "SHIPPER_CREATED",
          entityType: "Shipper",
          entityId: created.id,
          after: created,
        }),
        async (tx) =>
          tx.shipper.create({
            // The tenant extension overwrites organizationId on the way
            // through, so this satisfies Prisma's input type without being a
            // second, hand-rolled source of truth for the tenant.
            data: { ...input, organizationId: ctx.organizationId },
            select: shipperSelect,
          }),
      );
    }),

  update: roleProcedure("ADMIN")
    .input(z.object({ shipperId: z.string().min(1), ...shipperDetails }))
    .output(shipperOutput)
    .mutation(async ({ ctx, input }) => {
      const { shipperId, ...details } = input;

      const before = await ctx.db.shipper.findFirst({
        where: { id: shipperId },
        select: shipperSelect,
      });

      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return withAudit(
        ctx.db,
        {
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "SHIPPER_UPDATED",
          entityType: "Shipper",
          entityId: shipperId,
          before,
          after: details,
        },
        async (tx) =>
          tx.shipper.update({
            where: { id: shipperId },
            data: details,
            select: shipperSelect,
          }),
      );
    }),

  publishProfileVersion: roleProcedure("ADMIN")
    .input(
      z.object({
        shipperId: z.string().min(1),
        rules: requirementRulesSchema,
        changeNote: z.string().max(500).nullable().default(null),
      }),
    )
    .output(profileVersionOutput)
    .mutation(async ({ ctx, input }) => {
      const shipper = await ctx.db.shipper.findFirst({
        where: { id: input.shipperId },
        select: { id: true },
      });

      if (!shipper) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return withAudit(
        ctx.db,
        (published) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "REQUIREMENT_PROFILE_PUBLISHED",
          entityType: "RequirementProfile",
          entityId: published.id,
          after: {
            shipperId: input.shipperId,
            version: published.version,
            rules: input.rules,
          },
        }),
        async (tx) => {
          // findFirst, never findUnique: the tenant extension services
          // findUnique through the outer client, which reads outside this
          // transaction and would miss its own uncommitted writes.
          const active = await tx.requirementProfile.findFirst({
            where: { shipperId: input.shipperId, supersededAt: null },
            select: { id: true, version: true },
          });

          if (active) {
            await tx.requirementProfile.update({
              where: { id: active.id },
              data: { supersededAt: new Date() },
            });
          }

          // Two admins publishing at once both read the same active version;
          // the partial unique index rejects whichever commits second.
          const published = await tx.requirementProfile.create({
            data: {
              organizationId: ctx.organizationId,
              shipperId: input.shipperId,
              version: (active?.version ?? 0) + 1,
              rules: input.rules,
              changeNote: input.changeNote,
              createdById: ctx.session.user.id,
            },
            select: profileSelect,
          });

          return toProfileVersion(published);
        },
      );
    }),
});
