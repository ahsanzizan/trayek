import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  orgProcedure,
  roleProcedure,
} from "~/server/api/trpc";
import { withAudit } from "~/server/audit/with-audit";
import { issueUploadToken } from "~/server/pod-link/issue";

/**
 * Signed POD upload links (TRK-024).
 *
 * Everything here is the console side: issuing, rotating, and revoking. The
 * driver side is a public route (`src/app/pod/[token]/page.tsx`) carrying no
 * session at all, which is the point — Pak Herman installs nothing and signs
 * in nowhere.
 */

/**
 * Two weeks. Long enough that a link sent on despatch still works when a trip
 * runs over, short enough that a link forwarded out of a WhatsApp group stops
 * working well before the invoice for that order is settled.
 */
const DEFAULT_EXPIRY_DAYS = 14;

/**
 * A driver retakes a photo two or three times, and a multi-page POD is several
 * captures. Ten leaves room for both without leaving a standing endpoint.
 */
const DEFAULT_USE_BUDGET = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The link as the console sees it. There is no `token` field and no
 * `tokenHash` field by design: the token exists in one response, at issue
 * time, and the digest is not the console's business.
 */
const linkOutput = z.object({
  id: z.string(),
  orderId: z.string(),
  expiresAt: z.date(),
  useBudget: z.number().int(),
  useCount: z.number().int(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.date(),
});

type LinkRow = z.infer<typeof linkOutput>;

const linkSelect = {
  id: true,
  orderId: true,
  expiresAt: true,
  useBudget: true,
  useCount: true,
  lastUsedAt: true,
  revokedAt: true,
  createdById: true,
  createdAt: true,
} as const;

const issuedOutput = linkOutput.extend({
  /**
   * Returned exactly once. It is not stored, cannot be recovered, and a caller
   * that loses it rotates the link rather than reading it back.
   */
  token: z.string(),
  /** Absolute, and short enough to sit in a WhatsApp message body. */
  url: z.string(),
});

const issueInput = z.object({
  orderId: z.string().min(1),
  expiresInDays: z.number().int().min(1).max(90).default(DEFAULT_EXPIRY_DAYS),
  useBudget: z.number().int().min(1).max(50).default(DEFAULT_USE_BUDGET),
});

/**
 * Builds the absolute link from the request rather than from configuration.
 *
 * The console runs on whatever host the admin opened, and behind a proxy that
 * is the forwarded host. Reading it here avoids a base-URL env var that would
 * be wrong in exactly the deployment where it mattered.
 */
function uploadUrlFor(headers: Headers, token: string): string {
  const forwardedHost = headers.get("x-forwarded-host");
  const host = forwardedHost ?? headers.get("host") ?? "localhost:3000";
  const protocol =
    headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return `${protocol}://${host}/pod/${token}`;
}

export const podLinkRouter = createTRPCRouter({
  listForOrder: orgProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .output(z.array(linkOutput))
    .query(async ({ ctx, input }) => {
      return ctx.db.podUploadLink.findMany({
        where: { orderId: input.orderId },
        select: linkSelect,
        orderBy: { createdAt: "desc" },
      });
    }),

  issue: roleProcedure("ADMIN")
    .input(issueInput)
    .output(issuedOutput)
    .mutation(async ({ ctx, input }) => {
      // Confirms the order is this tenant's before a link is minted against
      // it. Without this, an id from another organization would produce a link
      // that resolves to nothing, which is a confusing way to fail.
      const order = await ctx.db.order.findFirst({
        where: { id: input.orderId },
        select: { id: true },
      });

      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { token, tokenHash } = issueUploadToken();
      const expiresAt = new Date(Date.now() + input.expiresInDays * DAY_MS);

      const created = await withAudit<LinkRow>(
        ctx.db,
        (link) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "POD_UPLOAD_LINK_ISSUED",
          entityType: "PodUploadLink",
          entityId: link.id,
          // Deliberately neither the token nor its digest: an audit row is
          // read by more people than the link is, and neither belongs in it.
          after: {
            orderId: link.orderId,
            expiresAt: link.expiresAt,
            useBudget: link.useBudget,
          },
        }),
        async (tx) =>
          tx.podUploadLink.create({
            data: {
              organizationId: ctx.organizationId,
              orderId: input.orderId,
              tokenHash,
              expiresAt,
              useBudget: input.useBudget,
              createdById: ctx.session.user.id,
            },
            select: linkSelect,
          }),
      );

      return { ...created, token, url: uploadUrlFor(ctx.headers, token) };
    }),

  revoke: roleProcedure("ADMIN")
    .input(z.object({ linkId: z.string().min(1) }))
    .output(linkOutput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.podUploadLink.findFirst({
        where: { id: input.linkId },
        select: linkSelect,
      });

      // A link belonging to another organization is absent, not forbidden.
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Revoking twice is not an error, but it must not move the timestamp:
      // when the link stopped working is the fact the record is keeping.
      if (existing.revokedAt !== null) {
        return existing;
      }

      return withAudit<LinkRow>(
        ctx.db,
        (link) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "POD_UPLOAD_LINK_REVOKED",
          entityType: "PodUploadLink",
          entityId: link.id,
          before: { revokedAt: null },
          after: { revokedAt: link.revokedAt },
        }),
        async (tx) =>
          tx.podUploadLink.update({
            where: { id: input.linkId },
            data: { revokedAt: new Date() },
            select: linkSelect,
          }),
      );
    }),

  rotate: roleProcedure("ADMIN")
    .input(
      issueInput.omit({ orderId: true }).extend({ linkId: z.string().min(1) }),
    )
    .output(issuedOutput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.podUploadLink.findFirst({
        where: { id: input.linkId },
        select: linkSelect,
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const { token, tokenHash } = issueUploadToken();
      const expiresAt = new Date(Date.now() + input.expiresInDays * DAY_MS);

      // One transaction, because a rotation that revoked the old link without
      // minting the new one leaves a driver holding a dead link and nobody
      // holding a live one.
      const created = await withAudit<LinkRow>(
        ctx.db,
        (link) => ({
          organizationId: ctx.organizationId,
          actor: { type: "USER", id: ctx.session.user.id },
          action: "POD_UPLOAD_LINK_ROTATED",
          entityType: "PodUploadLink",
          entityId: link.id,
          before: { replacedLinkId: existing.id },
          after: {
            orderId: link.orderId,
            expiresAt: link.expiresAt,
            useBudget: link.useBudget,
          },
        }),
        async (tx) => {
          if (existing.revokedAt === null) {
            await tx.podUploadLink.update({
              where: { id: existing.id },
              data: { revokedAt: new Date() },
              select: { id: true },
            });
          }

          return tx.podUploadLink.create({
            data: {
              organizationId: ctx.organizationId,
              orderId: existing.orderId,
              tokenHash,
              expiresAt,
              useBudget: input.useBudget,
              createdById: ctx.session.user.id,
            },
            select: linkSelect,
          });
        },
      );

      return { ...created, token, url: uploadUrlFor(ctx.headers, token) };
    }),
});
