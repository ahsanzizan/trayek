import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import {
  hashThrottleBucket,
  hashUploadToken,
  isWellFormedUploadToken,
} from "~/server/domain/pod-link/token";
import { resolveUploadLink } from "~/server/pod-link/resolve";

const organizationA = seedFixturesData.organizations[0];
const organizationB = seedFixturesData.organizations[1];
const orderA = seedFixturesData.orders[0];
const orderB = seedFixturesData.orders[2];

if (!organizationA || !organizationB || !orderA || !orderB) {
  throw new Error("Seed requires two forwarder organizations with orders");
}

function callerFor(userId: string, organizationId: string) {
  return createCaller(() =>
    Promise.resolve({
      db,
      headers: new Headers({
        host: "settle.trayek.id",
        "x-forwarded-proto": "https",
      }),
      requestId: "pod-link-router-test",
      session: {
        user: { id: userId, activeOrganizationId: organizationId },
        memberships: [],
        expires: "2099-01-01T00:00:00.000Z",
      },
    }),
  );
}

const admin = callerFor("user-forwarder-a-admin", organizationA.id);
const finance = callerFor("user-forwarder-a-finance", organizationA.id);
const ownerB = callerFor("user-forwarder-b-owner", organizationB.id);

const createdLinkIds: string[] = [];
const usedBuckets: string[] = [];

async function issueLink(useBudget = 10) {
  const link = await admin.podLink.issue({
    orderId: orderA.id,
    expiresInDays: 14,
    useBudget,
  });

  createdLinkIds.push(link.id);
  usedBuckets.push(hashThrottleBucket("token", hashUploadToken(link.token)));
  return link;
}

afterAll(async () => {
  // The audit rows these tests wrote are deliberately left behind: `AuditLog`
  // is append-only and a Postgres trigger refuses the DELETE. Cleaning them up
  // is not merely unnecessary, it is the thing INV-1 and INV-7 forbid.
  await db.podUploadLink.deleteMany({ where: { id: { in: createdLinkIds } } });
  await db.podUploadThrottle.deleteMany({
    where: { bucket: { in: usedBuckets } },
  });
  await db.$disconnect();
});

describe("issuing a link", () => {
  it("returns a well-formed token and an absolute URL containing it", async () => {
    const link = await issueLink();

    expect(isWellFormedUploadToken(link.token)).toBe(true);
    expect(link.url).toBe(`https://settle.trayek.id/pod/${link.token}`);
    expect(link.orderId).toBe(orderA.id);
    expect(link.useCount).toBe(0);
    expect(link.revokedAt).toBeNull();
  });

  it("stores the digest and never the token itself", async () => {
    const link = await issueLink();

    const stored = await db.podUploadLink.findUniqueOrThrow({
      where: { id: link.id },
      select: { tokenHash: true },
    });

    expect(stored.tokenHash).toBe(hashUploadToken(link.token));
    expect(JSON.stringify(stored)).not.toContain(link.token);
  });

  it("mints a different token every time", async () => {
    const first = await issueLink();
    const second = await issueLink();

    expect(first.token).not.toBe(second.token);
  });

  it("produces a link the public route resolves to the right order", async () => {
    const link = await issueLink();

    const result = await resolveUploadLink({
      db,
      token: link.token,
      ipAddress: null,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.link.orderId).toBe(orderA.id);
    expect(result.link.nomorOrder).toBe(orderA.nomorOrder);
  });

  it("writes an audit entry that names the link but not the token", async () => {
    const link = await issueLink();

    const entry = await db.auditLog.findFirstOrThrow({
      where: {
        entityType: "PodUploadLink",
        entityId: link.id,
        action: "POD_UPLOAD_LINK_ISSUED",
      },
      select: { actorId: true, after: true, organizationId: true },
    });

    expect(entry.actorId).toBe("user-forwarder-a-admin");
    expect(entry.organizationId).toBe(organizationA.id);
    expect(JSON.stringify(entry.after)).not.toContain(link.token);
    expect(JSON.stringify(entry.after)).not.toContain(
      hashUploadToken(link.token),
    );
  });

  it("refuses an order belonging to another organization", async () => {
    await expect(
      admin.podLink.issue({
        orderId: orderB.id,
        expiresInDays: 14,
        useBudget: 10,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is closed to a member without the role", async () => {
    await expect(
      finance.podLink.issue({
        orderId: orderA.id,
        expiresInDays: 14,
        useBudget: 10,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("revoking a link", () => {
  it("stops the link resolving", async () => {
    const link = await issueLink();

    await admin.podLink.revoke({ linkId: link.id });

    expect(
      await resolveUploadLink({ db, token: link.token, ipAddress: null }),
    ).toEqual({ ok: false, reason: "REVOKED" });
  });

  it("keeps the original timestamp when revoked twice", async () => {
    const link = await issueLink();

    const first = await admin.podLink.revoke({ linkId: link.id });
    const second = await admin.podLink.revoke({ linkId: link.id });

    expect(second.revokedAt).toEqual(first.revokedAt);
  });

  it("reports another organization's link as absent, not forbidden", async () => {
    const link = await issueLink();

    await expect(
      ownerB.podLink.revoke({ linkId: link.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an audit entry", async () => {
    const link = await issueLink();
    await admin.podLink.revoke({ linkId: link.id });

    const entry = await db.auditLog.findFirst({
      where: {
        entityType: "PodUploadLink",
        entityId: link.id,
        action: "POD_UPLOAD_LINK_REVOKED",
      },
    });

    expect(entry).not.toBeNull();
  });
});

describe("rotating a link", () => {
  it("kills the old token and issues a working one for the same order", async () => {
    const original = await issueLink();

    const rotated = await admin.podLink.rotate({
      linkId: original.id,
      expiresInDays: 14,
      useBudget: 10,
    });

    createdLinkIds.push(rotated.id);
    usedBuckets.push(
      hashThrottleBucket("token", hashUploadToken(rotated.token)),
    );

    expect(rotated.id).not.toBe(original.id);
    expect(rotated.orderId).toBe(original.orderId);
    expect(rotated.token).not.toBe(original.token);

    expect(
      await resolveUploadLink({ db, token: original.token, ipAddress: null }),
    ).toEqual({ ok: false, reason: "REVOKED" });

    const live = await resolveUploadLink({
      db,
      token: rotated.token,
      ipAddress: null,
    });

    expect(live.ok).toBe(true);
  });

  it("rotates a link that was already revoked without moving its timestamp", async () => {
    const original = await issueLink();
    const revoked = await admin.podLink.revoke({ linkId: original.id });

    const rotated = await admin.podLink.rotate({
      linkId: original.id,
      expiresInDays: 14,
      useBudget: 10,
    });

    createdLinkIds.push(rotated.id);
    usedBuckets.push(
      hashThrottleBucket("token", hashUploadToken(rotated.token)),
    );

    const stored = await db.podUploadLink.findUniqueOrThrow({
      where: { id: original.id },
      select: { revokedAt: true },
    });

    expect(stored.revokedAt).toEqual(revoked.revokedAt);
  });

  it("reports another organization's link as absent", async () => {
    const link = await issueLink();

    await expect(
      ownerB.podLink.rotate({
        linkId: link.id,
        expiresInDays: 14,
        useBudget: 10,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listing links for an order", () => {
  it("returns the links issued against the order, newest first", async () => {
    const link = await issueLink();

    const links = await admin.podLink.listForOrder({ orderId: orderA.id });

    expect(links.map((row) => row.id)).toContain(link.id);
    expect(links[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
      links[links.length - 1]?.createdAt.getTime() ?? 0,
    );
  });

  it("never returns a token or a digest", async () => {
    const link = await issueLink();

    const links = await admin.podLink.listForOrder({ orderId: orderA.id });
    const serialised = JSON.stringify(links);

    expect(serialised).not.toContain(link.token);
    expect(serialised).not.toContain(hashUploadToken(link.token));
    expect(serialised).not.toContain("tokenHash");
  });

  it("shows another organization nothing for the same order id", async () => {
    await issueLink();

    expect(await ownerB.podLink.listForOrder({ orderId: orderA.id })).toEqual(
      [],
    );
  });
});
