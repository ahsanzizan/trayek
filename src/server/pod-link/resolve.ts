import { type PrismaClient } from "../../../generated/prisma";
import {
  evaluateLinkAccess,
  type LinkRefusalReason,
} from "~/server/domain/pod-link/access";
import {
  evaluateThrottle,
  POD_LINK_IP_THROTTLE,
  POD_LINK_TOKEN_THROTTLE,
  type ThrottlePolicy,
} from "~/server/domain/pod-link/throttle";
import {
  hashThrottleBucket,
  hashUploadToken,
  isWellFormedUploadToken,
  normalizeUploadToken,
} from "~/server/domain/pod-link/token";
import { logger } from "~/server/observability/logger";

/**
 * Resolution of a public POD upload link (TRK-024).
 *
 * This is the one path in the application that reads a tenant-scoped model
 * outside `orgProcedure`, because there is no session to scope by: the driver
 * has no account, and the token is the entire authorization. What replaces the
 * tenant filter is that every read below is keyed by the token digest, and the
 * order is loaded through the link's own `orderId` — so a token can only ever
 * reach the one order it was issued for, in the organization that issued it.
 */

/** What the driver's screen needs in order to confirm he is on the right link. */
export type ResolvedUploadLink = {
  linkId: string;
  organizationId: string;
  orderId: string;
  nomorOrder: string;
  nomorSuratJalan: string;
  destination: string;
  remainingUses: number;
  /**
   * The link's total budget, which is what `consumeUploadLinkUse` guards
   * against. Carried separately from `remainingUses` because the two are not
   * interchangeable: the guard compares against the absolute `useCount`, and
   * deriving one from the other is how a link came to work exactly once.
   */
  useBudget: number;
  expiresAt: Date;
};

export type ResolveUploadLinkResult =
  | { ok: true; link: ResolvedUploadLink }
  | { ok: false; reason: LinkRefusalReason };

type ResolveInput = {
  db: PrismaClient;
  token: string;
  /** Null when the request carries no usable client address. */
  ipAddress: string | null;
  now?: Date;
};

async function consumeThrottle(
  db: PrismaClient,
  bucket: string,
  policy: ThrottlePolicy,
  now: Date,
): Promise<boolean> {
  const existing = await db.podUploadThrottle.findUnique({
    where: { bucket },
    select: { windowStartedAt: true, count: true },
  });

  const decision = evaluateThrottle(existing, policy, now);

  await db.podUploadThrottle.upsert({
    where: { bucket },
    create: {
      bucket,
      windowStartedAt: decision.next.windowStartedAt,
      count: decision.next.count,
    },
    update: {
      windowStartedAt: decision.next.windowStartedAt,
      count: decision.next.count,
    },
  });

  return decision.allowed;
}

export async function resolveUploadLink({
  db,
  token,
  ipAddress,
  now = new Date(),
}: ResolveInput): Promise<ResolveUploadLinkResult> {
  const normalized = normalizeUploadToken(token);

  // Rejected before any database read: a scan for live tokens should cost the
  // scanner a round trip and cost us nothing.
  if (!isWellFormedUploadToken(normalized)) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const tokenHash = hashUploadToken(normalized);

  if (ipAddress !== null) {
    const ipAllowed = await consumeThrottle(
      db,
      hashThrottleBucket("ip", ipAddress),
      POD_LINK_IP_THROTTLE,
      now,
    );

    if (!ipAllowed) {
      return { ok: false, reason: "THROTTLED" };
    }
  }

  const tokenAllowed = await consumeThrottle(
    db,
    hashThrottleBucket("token", tokenHash),
    POD_LINK_TOKEN_THROTTLE,
    now,
  );

  if (!tokenAllowed) {
    return { ok: false, reason: "THROTTLED" };
  }

  const link = await db.podUploadLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      orderId: true,
      expiresAt: true,
      revokedAt: true,
      useBudget: true,
      useCount: true,
      order: {
        select: {
          nomorOrder: true,
          nomorSuratJalan: true,
          destination: true,
        },
      },
    },
  });

  if (!link) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const decision = evaluateLinkAccess(link, now);

  // The link id, never the token: the id names the row for an admin looking
  // for it, and is useless to anyone who intercepts the log.
  logger.info("POD upload link resolved", {
    linkId: link.id,
    organizationId: link.organizationId,
    allowed: decision.allowed,
    reason: decision.allowed ? null : decision.reason,
  });

  if (!decision.allowed) {
    return { ok: false, reason: decision.reason };
  }

  return {
    ok: true,
    link: {
      linkId: link.id,
      organizationId: link.organizationId,
      orderId: link.orderId,
      nomorOrder: link.order.nomorOrder,
      nomorSuratJalan: link.order.nomorSuratJalan,
      destination: link.order.destination,
      remainingUses: decision.remainingUses,
      useBudget: link.useBudget,
      expiresAt: link.expiresAt,
    },
  };
}

/**
 * Spends one use of a link, for the upload path that lands in TRK-030.
 *
 * The guard is in the `where`, not in a prior read: two photos submitted at
 * once would both pass a read-then-write check and take the budget past its
 * limit. `updateMany` reporting zero rows is how a caller learns it lost.
 */
export async function consumeUploadLinkUse({
  db,
  linkId,
  useBudget,
  now = new Date(),
}: {
  db: PrismaClient;
  linkId: string;
  useBudget: number;
  now?: Date;
}): Promise<boolean> {
  const result = await db.podUploadLink.updateMany({
    where: {
      id: linkId,
      revokedAt: null,
      expiresAt: { gt: now },
      useCount: { lt: useBudget },
    },
    data: { useCount: { increment: 1 }, lastUsedAt: now },
  });

  return result.count === 1;
}
