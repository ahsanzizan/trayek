import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import { seedFixturesData, SEED_POD_LINK_TOKENS } from "../../prisma/seed";
import { db } from "~/server/db";
import { LINK_REFUSAL_MESSAGES } from "~/server/domain/pod-link/access";
import {
  hashThrottleBucket,
  hashUploadToken,
} from "~/server/domain/pod-link/token";

/**
 * TRK-024 acceptance criterion: an expired or revoked token renders a plain
 * Indonesian message telling the driver to contact the admin, not a stack
 * trace. This renders the actual route component to prove it.
 */

const requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.44" });

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(requestHeaders),
}));

const { default: PodUploadPage } =
  await import("~/app/(driver)/pod/[token]/page");

const orderA = seedFixturesData.orders[0];

if (!orderA) {
  throw new Error("Seed requires an order to link against");
}

const createdLinkIds: string[] = [];
const usedBuckets: string[] = [hashThrottleBucket("ip", "203.0.113.44")];

function tokenFor(label: string): string {
  return `PAGE${label}`
    .toUpperCase()
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "0")
    .padEnd(20, "0")
    .slice(0, 20);
}

async function createLink(
  token: string,
  overrides: {
    expiresAt?: Date;
    revokedAt?: Date;
    useBudget?: number;
    useCount?: number;
  } = {},
) {
  const link = await db.podUploadLink.create({
    data: {
      organizationId: orderA.organizationId,
      orderId: orderA.id,
      tokenHash: hashUploadToken(token),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86_400_000),
      revokedAt: overrides.revokedAt ?? null,
      useBudget: overrides.useBudget ?? 10,
      useCount: overrides.useCount ?? 0,
    },
    select: { id: true },
  });

  createdLinkIds.push(link.id);
  usedBuckets.push(hashThrottleBucket("token", hashUploadToken(token)));
  return link;
}

async function renderFor(token: string): Promise<string> {
  const element = await PodUploadPage({ params: Promise.resolve({ token }) });

  return renderToStaticMarkup(element);
}

afterAll(async () => {
  usedBuckets.push(
    hashThrottleBucket(
      "token",
      hashUploadToken(SEED_POD_LINK_TOKENS.forwarderA),
    ),
  );

  await db.podUploadLink.deleteMany({ where: { id: { in: createdLinkIds } } });
  await db.podUploadThrottle.deleteMany({
    where: { bucket: { in: usedBuckets } },
  });
  await db.$disconnect();
});

describe("a live link", () => {
  it("shows the order the driver should be confirming", async () => {
    const markup = await renderFor(SEED_POD_LINK_TOKENS.forwarderA);

    expect(markup).toContain(orderA.nomorOrder);
    expect(markup).toContain(orderA.nomorSuratJalan);
    expect(markup).toContain(orderA.destination);
  });

  it("does not echo the token back into the page", async () => {
    const markup = await renderFor(SEED_POD_LINK_TOKENS.forwarderA);

    expect(markup).not.toContain(SEED_POD_LINK_TOKENS.forwarderA);
  });
});

describe("a link that cannot be used", () => {
  it("renders the Indonesian expiry message, not a stack trace", async () => {
    const token = tokenFor("EXP");
    await createLink(token, { expiresAt: new Date(Date.now() - 1_000) });

    const markup = await renderFor(token);

    expect(markup).toContain(LINK_REFUSAL_MESSAGES.EXPIRED);
    expect(markup).toContain("Hubungi admin");
    expect(markup).not.toMatch(/Error|at \w+ \(|stack/i);
  });

  it("renders the Indonesian revocation message", async () => {
    const token = tokenFor("REV");
    await createLink(token, { revokedAt: new Date(Date.now() - 1_000) });

    const markup = await renderFor(token);

    expect(markup).toContain(LINK_REFUSAL_MESSAGES.REVOKED);
    expect(markup).toContain("Hubungi admin");
  });

  it("renders the Indonesian exhaustion message", async () => {
    const token = tokenFor("SPT");
    await createLink(token, { useBudget: 1, useCount: 1 });

    const markup = await renderFor(token);

    expect(markup).toContain(LINK_REFUSAL_MESSAGES.EXHAUSTED);
  });

  it("renders a plain message for a token that never existed", async () => {
    const markup = await renderFor(tokenFor("GONE"));

    expect(markup).toContain(LINK_REFUSAL_MESSAGES.NOT_FOUND);
    expect(markup).not.toMatch(/Error|at \w+ \(|stack/i);
  });

  it("does not crash on a malformed token", async () => {
    const markup = await renderFor("../../etc/passwd");

    expect(markup).toContain(LINK_REFUSAL_MESSAGES.NOT_FOUND);
  });

  it("shows no order detail to a token that did not resolve", async () => {
    const markup = await renderFor(tokenFor("GONE"));

    expect(markup).not.toContain(orderA.nomorOrder);
    expect(markup).not.toContain(orderA.nomorSuratJalan);
  });
});
