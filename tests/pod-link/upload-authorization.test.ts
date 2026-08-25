import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { db } from "~/server/db";
import {
  hashThrottleBucket,
  hashUploadToken,
} from "~/server/domain/pod-link/token";
import { authorizePodUpload } from "~/server/storage/router";
import {
  discardEmptyPodSubmission,
  recordPodSubmissionPage,
} from "~/server/pod-link/submission";

/**
 * TRK-030: the upload path is authorized by the link, not by the client.
 *
 * Before this issue, `podUploader` took `organizationId` and `loadId` from the
 * request body with the driver token optional and unchecked, which meant any
 * caller could write against any tenant. These tests are what stops that
 * coming back.
 */

const orderA = seedFixturesData.orders[0];
const orderB = seedFixturesData.orders[2];

if (!orderA || !orderB) {
  throw new Error("Seed requires an order in each forwarder organization");
}

const suffix = Date.now().toString().slice(-8);
const createdLinkIds: string[] = [];
const createdSubmissionIds: string[] = [];
const usedBuckets: string[] = [];

function tokenFor(label: string): string {
  return `${label}${suffix}`
    .toUpperCase()
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "0")
    .padEnd(20, "0")
    .slice(0, 20);
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
    select: { id: true, useBudget: true, useCount: true },
  });

  createdLinkIds.push(link.id);
  usedBuckets.push(hashThrottleBucket("token", hashUploadToken(token)));
  return link;
}

function authorize(token: string, fileNames = ["pod.jpg"]) {
  return authorizePodUpload({
    input: { token },
    files: fileNames.map((name) => ({ name })),
  });
}

async function track<T extends { podSubmissionId: string }>(
  result: Promise<T>,
): Promise<T> {
  const resolved = await result;
  createdSubmissionIds.push(resolved.podSubmissionId);
  return resolved;
}

afterAll(async () => {
  await db.podSubmissionPage.deleteMany({
    where: { podSubmissionId: { in: createdSubmissionIds } },
  });
  await db.podSubmission.deleteMany({
    where: { id: { in: createdSubmissionIds } },
  });
  await db.podUploadLink.deleteMany({ where: { id: { in: createdLinkIds } } });
  await db.podUploadThrottle.deleteMany({
    where: { bucket: { in: usedBuckets } },
  });
  await db.$disconnect();
});

describe("authorizing an upload", () => {
  it("takes the organization and order from the link, never from the caller", async () => {
    const token = tokenFor("AUTH");
    const link = await createLink(token);

    const metadata = await track(authorize(token));

    expect(metadata.organizationId).toBe(orderA.organizationId);
    expect(metadata.orderId).toBe(orderA.id);
    expect(metadata.podUploadLinkId).toBe(link.id);
  });

  it("opens one submission for the batch", async () => {
    const token = tokenFor("BATCH");
    await createLink(token);

    const metadata = await track(
      authorize(token, ["depan.jpg", "belakang.jpg"]),
    );

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: metadata.podSubmissionId },
      select: { orderId: true, organizationId: true },
    });

    expect(submission.orderId).toBe(orderA.id);
    expect(submission.organizationId).toBe(orderA.organizationId);
  });

  it("keeps the driver's capture order across a batch", async () => {
    const token = tokenFor("ORDERED");
    await createLink(token);

    const metadata = await track(
      authorize(token, ["halaman-1.jpg", "halaman-2.jpg", "halaman-3.jpg"]),
    );

    expect(metadata.pageIndexByName).toEqual({
      "halaman-1.jpg": 0,
      "halaman-2.jpg": 1,
      "halaman-3.jpg": 2,
    });
  });

  it("spends one use of the link per batch, not one per photograph", async () => {
    const token = tokenFor("SPEND");
    const link = await createLink(token, { useBudget: 5 });

    await track(authorize(token, ["a.jpg", "b.jpg", "c.jpg"]));

    const after = await db.podUploadLink.findUniqueOrThrow({
      where: { id: link.id },
      select: { useCount: true },
    });

    expect(after.useCount).toBe(1);
  });
});

describe("a link used more than once", () => {
  it("authorizes every upload until the budget is actually spent", async () => {
    // The defect this covers: the budget guard was handed `remainingUses + 1`
    // and compared against the absolute `useCount`, so the arithmetic only
    // held while `useCount` was 0. A link authorized its first upload and
    // refused every one after it, with budget still left. Every earlier test
    // used a fresh link, which is exactly why none of them caught it.
    const token = tokenFor("REUSE");
    const link = await createLink(token, { useBudget: 4 });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const metadata = await track(authorize(token, [`foto-${attempt}.jpg`]));

      expect(
        metadata.orderId,
        `upload ${attempt} of 4 was refused with budget remaining`,
      ).toBe(orderA.id);
    }

    const after = await db.podUploadLink.findUniqueOrThrow({
      where: { id: link.id },
      select: { useCount: true },
    });

    expect(after.useCount).toBe(4);
  });

  it("refuses only once the budget is genuinely exhausted", async () => {
    const token = tokenFor("EXHAUST");
    await createLink(token, { useBudget: 2 });

    await track(authorize(token, ["satu.jpg"]));
    await track(authorize(token, ["dua.jpg"]));

    await expect(authorize(token, ["tiga.jpg"])).rejects.toThrow();
  });

  it("resumes correctly for a link that already had uses on it", async () => {
    const token = tokenFor("PARTIAL");
    await createLink(token, { useBudget: 10, useCount: 6 });

    const metadata = await track(authorize(token));

    expect(metadata.orderId).toBe(orderA.id);
  });
});

describe("an upload that must not be authorized", () => {
  it("refuses an unknown token", async () => {
    await expect(authorize(tokenFor("NOSUCH"))).rejects.toThrow();
  });

  it("refuses a malformed token", async () => {
    await expect(authorize("not-a-token")).rejects.toThrow();
  });

  it("refuses a revoked link", async () => {
    const token = tokenFor("REVOKED");
    await createLink(token, { revokedAt: new Date(Date.now() - 1_000) });

    await expect(authorize(token)).rejects.toThrow();
  });

  it("refuses an expired link", async () => {
    const token = tokenFor("EXPIRED");
    await createLink(token, { expiresAt: new Date(Date.now() - 1_000) });

    await expect(authorize(token)).rejects.toThrow();
  });

  it("refuses once the use budget is spent", async () => {
    const token = tokenFor("SPENTUP");
    await createLink(token, { useBudget: 1, useCount: 1 });

    await expect(authorize(token)).rejects.toThrow();
  });

  it("refuses as forbidden, not as too large", async () => {
    // A dead link reported as HTTP 413 Payload Too Large sends whoever is
    // debugging it looking at file sizes instead of the link.
    const token = tokenFor("CODE");
    await createLink(token, { revokedAt: new Date() });

    await expect(authorize(token)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("writes no submission when it refuses", async () => {
    const token = tokenFor("NOWRITE");
    const link = await createLink(token, { revokedAt: new Date() });

    await expect(authorize(token)).rejects.toThrow();

    expect(
      await db.podSubmission.count({ where: { podUploadLinkId: link.id } }),
    ).toBe(0);
  });
});

describe("tenant isolation on upload", () => {
  it("cannot be pointed at another organization's order", async () => {
    // A link issued by organization B, presented for upload. It must land on
    // B's order in B's organization, whatever the caller would have preferred.
    const token = tokenFor("TENANTB");
    await createLink(token, {
      organizationId: orderB.organizationId,
      orderId: orderB.id,
    });

    const metadata = await track(authorize(token));

    expect(metadata.organizationId).toBe(orderB.organizationId);
    expect(metadata.orderId).toBe(orderB.id);
    expect(metadata.organizationId).not.toBe(orderA.organizationId);
  });

  it("stamps the page with the same organization as its submission", async () => {
    const token = tokenFor("PAGEORG");
    await createLink(token, {
      organizationId: orderB.organizationId,
      orderId: orderB.id,
    });

    const metadata = await track(authorize(token));

    await recordPodSubmissionPage({
      db,
      organizationId: metadata.organizationId,
      podSubmissionId: metadata.podSubmissionId,
      storageKey: `key-${suffix}-org`,
      fileName: "pod.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      pageIndex: 0,
    });

    const page = await db.podSubmissionPage.findFirstOrThrow({
      where: { podSubmissionId: metadata.podSubmissionId },
      select: { organizationId: true },
    });

    expect(page.organizationId).toBe(orderB.organizationId);
  });
});

describe("recording the photographs", () => {
  it("stores each page against the submission in capture order", async () => {
    const token = tokenFor("PAGES");
    await createLink(token);
    const metadata = await track(authorize(token, ["satu.jpg", "dua.jpg"]));

    for (const [index, name] of ["satu.jpg", "dua.jpg"].entries()) {
      await recordPodSubmissionPage({
        db,
        organizationId: metadata.organizationId,
        podSubmissionId: metadata.podSubmissionId,
        storageKey: `key-${suffix}-${index}`,
        fileName: name,
        contentType: "image/jpeg",
        sizeBytes: 2048,
        pageIndex: metadata.pageIndexByName[name] ?? null,
      });
    }

    const pages = await db.podSubmissionPage.findMany({
      where: { podSubmissionId: metadata.podSubmissionId },
      orderBy: { pageIndex: "asc" },
      select: { pageIndex: true, fileName: true },
    });

    expect(pages).toEqual([
      { pageIndex: 0, fileName: "satu.jpg" },
      { pageIndex: 1, fileName: "dua.jpg" },
    ]);
  });

  it("falls back to arrival order when the batch could not name the page", async () => {
    const token = tokenFor("FALLBACK");
    await createLink(token);
    const metadata = await track(authorize(token));

    for (let index = 0; index < 3; index += 1) {
      await recordPodSubmissionPage({
        db,
        organizationId: metadata.organizationId,
        podSubmissionId: metadata.podSubmissionId,
        storageKey: `key-${suffix}-fb-${index}`,
        fileName: `tanpa-nama-${index}.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 512,
        pageIndex: null,
      });
    }

    const indexes = await db.podSubmissionPage.findMany({
      where: { podSubmissionId: metadata.podSubmissionId },
      orderBy: { pageIndex: "asc" },
      select: { pageIndex: true },
    });

    expect(indexes.map((row) => row.pageIndex)).toEqual([0, 1, 2]);
  });

  it("discards a submission whose every upload failed", async () => {
    const token = tokenFor("EMPTY");
    await createLink(token);
    const metadata = await track(authorize(token));

    expect(
      await discardEmptyPodSubmission({
        db,
        podSubmissionId: metadata.podSubmissionId,
      }),
    ).toBe(true);

    expect(
      await db.podSubmission.findUnique({
        where: { id: metadata.podSubmissionId },
      }),
    ).toBeNull();
  });

  it("keeps a submission that received at least one page", async () => {
    const token = tokenFor("KEEP");
    await createLink(token);
    const metadata = await track(authorize(token));

    await recordPodSubmissionPage({
      db,
      organizationId: metadata.organizationId,
      podSubmissionId: metadata.podSubmissionId,
      storageKey: `key-${suffix}-keep`,
      fileName: "pod.jpg",
      contentType: "image/jpeg",
      sizeBytes: 4096,
      pageIndex: 0,
    });

    expect(
      await discardEmptyPodSubmission({
        db,
        podSubmissionId: metadata.podSubmissionId,
      }),
    ).toBe(false);
  });

  it("never logs the storage key, which reaches a signed document", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/server/pod-link/submission.ts", "utf8"),
    );

    const logCall = source.slice(source.indexOf("logger.info"));

    expect(logCall).toContain("pageId");
    expect(logCall).not.toContain("storageKey,");
  });
});
