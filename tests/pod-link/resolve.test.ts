import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData, SEED_POD_LINK_TOKENS } from "../../prisma/seed";
import { db } from "~/server/db";
import {
  hashThrottleBucket,
  hashUploadToken,
} from "~/server/domain/pod-link/token";
import { POD_LINK_TOKEN_THROTTLE } from "~/server/domain/pod-link/throttle";
import {
  consumeUploadLinkUse,
  resolveUploadLink,
} from "~/server/pod-link/resolve";

const orderA = seedFixturesData.orders[0];
const orderB = seedFixturesData.orders[2];

if (!orderA || !orderB) {
  throw new Error("Seed requires an order in each forwarder organization");
}

const suffix = Date.now().toString().slice(-8);
const createdLinkIds: string[] = [];
const usedBuckets: string[] = [];

/** A token from the alphabet, unique per test, so buckets never collide. */
function tokenFor(label: string): string {
  const body = `${label}${suffix}`
    .toUpperCase()
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "0");
  return body.padEnd(20, "0").slice(0, 20);
}

/** A distinct client address per test, for the same reason. */
function ipFor(label: string): string {
  const octet = (label.length * 7) % 250;
  return `198.51.100.${octet}`;
}

async function createLink(
  token: string,
  overrides: {
    orderId?: string;
    organizationId?: string;
    expiresAt?: Date;
    revokedAt?: Date | null;
    useBudget?: number;
    useCount?: number;
  } = {},
) {
  const link = await db.podUploadLink.create({
    data: {
      organizationId: overrides.organizationId ?? orderA.organizationId,
      orderId: overrides.orderId ?? orderA.id,
      tokenHash: hashUploadToken(token),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86_400_000),
      revokedAt: overrides.revokedAt ?? null,
      useBudget: overrides.useBudget ?? 10,
      useCount: overrides.useCount ?? 0,
    },
    select: { id: true, useBudget: true },
  });

  createdLinkIds.push(link.id);
  usedBuckets.push(hashThrottleBucket("token", hashUploadToken(token)));
  return link;
}

afterAll(async () => {
  for (const token of Object.values(SEED_POD_LINK_TOKENS)) {
    usedBuckets.push(hashThrottleBucket("token", hashUploadToken(token)));
  }

  await db.podUploadLink.deleteMany({ where: { id: { in: createdLinkIds } } });
  await db.podUploadThrottle.deleteMany({
    where: { bucket: { in: usedBuckets } },
  });
  await db.$disconnect();
});

describe("resolving a live link", () => {
  it("returns the order the driver should be looking at", async () => {
    const result = await resolveUploadLink({
      db,
      token: SEED_POD_LINK_TOKENS.forwarderA,
      ipAddress: ipFor("live"),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.link.orderId).toBe(orderA.id);
    expect(result.link.nomorOrder).toBe(orderA.nomorOrder);
    expect(result.link.nomorSuratJalan).toBe(orderA.nomorSuratJalan);
    expect(result.link.destination).toBe(orderA.destination);
    expect(result.link.remainingUses).toBeGreaterThan(0);
  });

  it("resolves a token that arrived lower-cased and padded with spaces", async () => {
    const result = await resolveUploadLink({
      db,
      token: `  ${SEED_POD_LINK_TOKENS.forwarderA.toLowerCase()} `,
      ipAddress: ipFor("normalised"),
    });

    expect(result.ok).toBe(true);
  });

  it("carries no token or digest in what it returns", async () => {
    const result = await resolveUploadLink({
      db,
      token: SEED_POD_LINK_TOKENS.forwarderA,
      ipAddress: ipFor("noleak"),
    });

    const serialised = JSON.stringify(result);

    expect(serialised).not.toContain(SEED_POD_LINK_TOKENS.forwarderA);
    expect(serialised).not.toContain(
      hashUploadToken(SEED_POD_LINK_TOKENS.forwarderA),
    );
  });
});

describe("a link that cannot be used", () => {
  it("reports an unknown token as absent", async () => {
    const result = await resolveUploadLink({
      db,
      token: tokenFor("GHOST"),
      ipAddress: ipFor("ghost"),
    });

    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("rejects a malformed token without touching the database", async () => {
    const ipAddress = "198.51.100.251";
    const bucket = hashThrottleBucket("ip", ipAddress);
    usedBuckets.push(bucket);

    const result = await resolveUploadLink({
      db,
      token: "not-a-token",
      ipAddress,
    });

    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });

    // Its throttle bucket was never opened, which is what proves the
    // rejection happened before any read rather than after a lookup missed.
    expect(
      await db.podUploadThrottle.findUnique({ where: { bucket } }),
    ).toBeNull();
  });

  it("reports an expired link as expired", async () => {
    const token = tokenFor("EXPIRED");
    await createLink(token, { expiresAt: new Date(Date.now() - 1_000) });

    const result = await resolveUploadLink({
      db,
      token,
      ipAddress: ipFor("expired"),
    });

    expect(result).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("reports a revoked link as revoked", async () => {
    const token = tokenFor("REVOKED");
    await createLink(token, { revokedAt: new Date(Date.now() - 1_000) });

    const result = await resolveUploadLink({
      db,
      token,
      ipAddress: ipFor("revoked"),
    });

    expect(result).toEqual({ ok: false, reason: "REVOKED" });
  });

  it("reports a spent budget as exhausted", async () => {
    const token = tokenFor("SPENT");
    await createLink(token, { useBudget: 2, useCount: 2 });

    const result = await resolveUploadLink({
      db,
      token,
      ipAddress: ipFor("spent"),
    });

    expect(result).toEqual({ ok: false, reason: "EXHAUSTED" });
  });
});

describe("tenant isolation", () => {
  it("resolves a token only to the order it was issued for", async () => {
    // The acceptance criterion: a token for order X cannot reach order Y.
    // Organization B's seeded token must land on B's order and nothing else.
    const result = await resolveUploadLink({
      db,
      token: SEED_POD_LINK_TOKENS.forwarderB,
      ipAddress: ipFor("tenantb"),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.link.orderId).toBe(orderB.id);
    expect(result.link.organizationId).toBe(orderB.organizationId);
    expect(result.link.orderId).not.toBe(orderA.id);
  });

  it("cannot be pointed at another organization's order by swapping tokens", async () => {
    const aResult = await resolveUploadLink({
      db,
      token: SEED_POD_LINK_TOKENS.forwarderA,
      ipAddress: ipFor("swapa"),
    });
    const bResult = await resolveUploadLink({
      db,
      token: SEED_POD_LINK_TOKENS.forwarderB,
      ipAddress: ipFor("swapb"),
    });

    expect(aResult.ok && bResult.ok).toBe(true);

    if (!aResult.ok || !bResult.ok) {
      return;
    }

    expect(aResult.link.organizationId).not.toBe(bResult.link.organizationId);
    expect(aResult.link.orderId).not.toBe(bResult.link.orderId);
  });
});

describe("throttling", () => {
  it("refuses a token once its window limit is passed", async () => {
    const token = tokenFor("FLOOD");
    await createLink(token);
    const ipAddress = ipFor("floodsource");

    const outcomes: boolean[] = [];

    for (
      let attempt = 0;
      attempt < POD_LINK_TOKEN_THROTTLE.limit + 1;
      attempt += 1
    ) {
      const result = await resolveUploadLink({ db, token, ipAddress: null });
      outcomes.push(result.ok);
    }

    expect(outcomes.slice(0, POD_LINK_TOKEN_THROTTLE.limit)).not.toContain(
      false,
    );
    expect(outcomes[POD_LINK_TOKEN_THROTTLE.limit]).toBe(false);

    const refused = await resolveUploadLink({ db, token, ipAddress });
    expect(refused).toEqual({ ok: false, reason: "THROTTLED" });

    usedBuckets.push(hashThrottleBucket("ip", ipAddress));
  });

  it("stores only digests, never a raw address or token", async () => {
    const rows = await db.podUploadThrottle.findMany({
      select: { bucket: true },
    });

    for (const row of rows) {
      expect(row.bucket).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("still resolves when the request carries no client address", async () => {
    const token = tokenFor("NOIP");
    await createLink(token);

    const result = await resolveUploadLink({ db, token, ipAddress: null });

    expect(result.ok).toBe(true);
  });
});

describe("spending a use", () => {
  it("increments the count and stamps when it was used", async () => {
    const token = tokenFor("SPEND");
    const link = await createLink(token, { useBudget: 3 });

    const consumed = await consumeUploadLinkUse({
      db,
      linkId: link.id,
      useBudget: link.useBudget,
    });

    expect(consumed).toBe(true);

    const after = await db.podUploadLink.findUniqueOrThrow({
      where: { id: link.id },
      select: { useCount: true, lastUsedAt: true },
    });

    expect(after.useCount).toBe(1);
    expect(after.lastUsedAt).not.toBeNull();
  });

  it("refuses to spend past the budget even when calls race", async () => {
    const token = tokenFor("RACE");
    const link = await createLink(token, { useBudget: 3 });

    // Five concurrent uploads against a budget of three. A read-then-write
    // guard would let all five through; the guard in the `where` clause is
    // what holds the line.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        consumeUploadLinkUse({
          db,
          linkId: link.id,
          useBudget: link.useBudget,
        }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(3);

    const after = await db.podUploadLink.findUniqueOrThrow({
      where: { id: link.id },
      select: { useCount: true },
    });

    expect(after.useCount).toBe(3);
  });

  it("refuses to spend a revoked link", async () => {
    const token = tokenFor("SPENDREV");
    const link = await createLink(token, { revokedAt: new Date() });

    expect(
      await consumeUploadLinkUse({
        db,
        linkId: link.id,
        useBudget: link.useBudget,
      }),
    ).toBe(false);
  });

  it("refuses to spend an expired link", async () => {
    const token = tokenFor("SPENDEXP");
    const link = await createLink(token, {
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(
      await consumeUploadLinkUse({
        db,
        linkId: link.id,
        useBudget: link.useBudget,
      }),
    ).toBe(false);
  });
});
