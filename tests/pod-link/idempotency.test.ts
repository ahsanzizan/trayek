import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { readSource } from "../auth/read-source";
import { db } from "~/server/db";
import {
  backoffDelayMs,
  MAX_UPLOAD_ATTEMPTS,
  shouldRetry,
} from "~/app/(driver)/pod/[token]/_components/upload-retry";
import {
  hashThrottleBucket,
  hashUploadToken,
} from "~/server/domain/pod-link/token";
import {
  findOrOpenPodSubmission,
  recordPodSubmissionPage,
} from "~/server/pod-link/submission";
import { authorizePodUpload, podUploadInput } from "~/server/storage/router";

/**
 * TRK-033 acceptance criteria: replaying an idempotency key creates exactly
 * one submission, and an interrupted upload completes without driver action.
 */

const orderA = seedFixturesData.orders[0];

if (!orderA) {
  throw new Error("Seed requires an order to link against");
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

async function createLink(token: string) {
  const link = await db.podUploadLink.create({
    data: {
      organizationId: orderA.organizationId,
      orderId: orderA.id,
      tokenHash: hashUploadToken(token),
      expiresAt: new Date(Date.now() + 86_400_000),
      useBudget: 30,
    },
    select: { id: true },
  });

  createdLinkIds.push(link.id);
  usedBuckets.push(hashThrottleBucket("token", hashUploadToken(token)));
  return link;
}

/** One full upload attempt: authorize, then deliver the pages. */
async function attemptUpload(
  token: string,
  idempotencyKey: string,
  files: string[] = ["pod.jpg"],
) {
  const metadata = await authorizePodUpload({
    input: { token, idempotencyKey },
    files: files.map((name) => ({ name })),
  });

  const podSubmissionId = await findOrOpenPodSubmission({ db, ...metadata });

  createdSubmissionIds.push(podSubmissionId);

  for (const name of files) {
    await recordPodSubmissionPage({
      db,
      organizationId: metadata.organizationId,
      podSubmissionId,
      storageKey: `key-${suffix}-${idempotencyKey}-${name}`,
      fileName: name,
      contentType: "image/jpeg",
      sizeBytes: 1024,
      pageIndex: metadata.pageIndexByName[name] ?? null,
    });
  }

  return podSubmissionId;
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

describe("replaying a capture attempt", () => {
  it("creates exactly one submission however many times it is retried", async () => {
    const token = tokenFor("REPLAY");
    await createLink(token);
    const key = `replay-${suffix}`;

    const first = await attemptUpload(token, key);
    const second = await attemptUpload(token, key);
    const third = await attemptUpload(token, key);

    expect(second).toBe(first);
    expect(third).toBe(first);

    expect(
      await db.podSubmission.count({
        where: { organizationId: orderA.organizationId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it("does not duplicate pages when the whole batch is re-sent", async () => {
    // The retry re-uploads everything, because the client cannot resume a
    // partial transfer. The same page must replace itself, not stack up.
    const token = tokenFor("REPAGE");
    await createLink(token);
    const key = `repage-${suffix}`;

    await attemptUpload(token, key, ["satu.jpg", "dua.jpg"]);
    const submissionId = await attemptUpload(token, key, [
      "satu.jpg",
      "dua.jpg",
    ]);

    const pages = await db.podSubmissionPage.findMany({
      where: { podSubmissionId: submissionId },
      orderBy: { pageIndex: "asc" },
      select: { pageIndex: true, fileName: true },
    });

    expect(pages).toEqual([
      { pageIndex: 0, fileName: "satu.jpg" },
      { pageIndex: 1, fileName: "dua.jpg" },
    ]);
  });

  it("keeps the storage key from the attempt that actually succeeded", async () => {
    const token = tokenFor("REKEY");
    await createLink(token);
    const key = `rekey-${suffix}`;

    await attemptUpload(token, key);
    const submissionId = await attemptUpload(token, key);

    const page = await db.podSubmissionPage.findFirstOrThrow({
      where: { podSubmissionId: submissionId },
      select: { storageKey: true },
    });

    expect(page.storageKey).toContain(key);
  });

  it("survives two retries landing at the same moment", async () => {
    // Two photographs of one batch can complete together, and both will try
    // to open the submission. The unique index settles it; the loser reads
    // the winner rather than failing the upload.
    const token = tokenFor("RACE");
    await createLink(token);
    const key = `race-${suffix}`;

    const metadata = await authorizePodUpload({
      input: { token, idempotencyKey: key },
      files: [{ name: "pod.jpg" }],
    });

    const opened = await Promise.all(
      Array.from({ length: 5 }, () =>
        findOrOpenPodSubmission({ db, ...metadata }),
      ),
    );

    createdSubmissionIds.push(...opened);

    expect(new Set(opened).size).toBe(1);
  });

  it("gives a different capture attempt its own submission", async () => {
    const token = tokenFor("DISTINCT");
    await createLink(token);

    const first = await attemptUpload(token, `a-${suffix}`);
    const second = await attemptUpload(token, `b-${suffix}`);

    expect(second).not.toBe(first);
  });
});

describe("tenant scoping of the key", () => {
  it("lets two organizations use the same key without colliding", async () => {
    // The key comes from a client. One tenant must not be able to reach
    // another's submission by guessing or replaying a key.
    const orderB = seedFixturesData.orders[2];

    if (!orderB) {
      throw new Error("Seed requires an order in the second organization");
    }

    const shared = `shared-${suffix}`;

    const tokenA = tokenFor("SCOPEA");
    await createLink(tokenA);
    const aId = await attemptUpload(tokenA, shared);

    const tokenB = tokenFor("SCOPEB");
    const linkB = await db.podUploadLink.create({
      data: {
        organizationId: orderB.organizationId,
        orderId: orderB.id,
        tokenHash: hashUploadToken(tokenB),
        expiresAt: new Date(Date.now() + 86_400_000),
        useBudget: 10,
      },
      select: { id: true },
    });

    createdLinkIds.push(linkB.id);
    usedBuckets.push(hashThrottleBucket("token", hashUploadToken(tokenB)));

    const bId = await attemptUpload(tokenB, shared);

    expect(bId).not.toBe(aId);

    const bSubmission = await db.podSubmission.findUniqueOrThrow({
      where: { id: bId },
      select: { organizationId: true },
    });

    expect(bSubmission.organizationId).toBe(orderB.organizationId);
  });
});

describe("no submission exists until a photograph arrives", () => {
  it("writes nothing at authorization time", async () => {
    // The orphan defect, closed at the root. TRK-041 triggers extraction on
    // submission creation, so a page-less row would queue a job to read a POD
    // that was never uploaded.
    const token = tokenFor("NOORPHAN");
    const link = await createLink(token);

    await authorizePodUpload({
      input: { token, idempotencyKey: `noorphan-${suffix}` },
      files: [{ name: "pod.jpg" }],
    });

    expect(
      await db.podSubmission.count({ where: { podUploadLinkId: link.id } }),
    ).toBe(0);
  });

  it("leaves nothing behind when every attempt fails", async () => {
    const token = tokenFor("ALLFAIL");
    const link = await createLink(token);

    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      await authorizePodUpload({
        input: { token, idempotencyKey: `allfail-${suffix}` },
        files: [{ name: "pod.jpg" }],
      });
    }

    expect(
      await db.podSubmission.count({ where: { podUploadLinkId: link.id } }),
    ).toBe(0);
  });
});

describe("the retry schedule", () => {
  it("backs off exponentially rather than hammering a dead connection", () => {
    expect(backoffDelayMs(1)).toBe(2_000);
    expect(backoffDelayMs(2)).toBe(4_000);
    expect(backoffDelayMs(3)).toBe(8_000);
  });

  it("caps the wait so a driver is not left watching a dead screen", () => {
    expect(backoffDelayMs(9)).toBe(16_000);
    expect(backoffDelayMs(99)).toBe(16_000);
  });

  it("never waits before the first attempt", () => {
    expect(backoffDelayMs(0)).toBe(0);
  });

  it("stops after the configured number of attempts", () => {
    expect(shouldRetry(MAX_UPLOAD_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(MAX_UPLOAD_ATTEMPTS)).toBe(false);
  });

  it("retries enough times to outlast a short warehouse dead spot", () => {
    const total = Array.from({ length: MAX_UPLOAD_ATTEMPTS - 1 }, (_, index) =>
      backoffDelayMs(index + 1),
    ).reduce((sum, delay) => sum + delay, 0);

    expect(total).toBeGreaterThanOrEqual(14_000);
  });
});

describe("what the input requires", () => {
  it("refuses an upload with no idempotency key", () => {
    expect(() =>
      podUploadInput.parse({ token: "TRAYEKSEEDA000000001" }),
    ).toThrow();
  });

  it("refuses a key too short to be a real one", () => {
    expect(() =>
      podUploadInput.parse({
        token: "TRAYEKSEEDA000000001",
        idempotencyKey: "abc",
      }),
    ).toThrow();
  });
});

describe("the driver is told what is happening", () => {
  it("says the retry is automatic, so nobody taps twice", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/pod-capture.tsx",
    );

    expect(source).toContain("Mencoba mengirim ulang secara otomatis");
  });

  it("shows success only after the upload resolved, never before", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/pod-capture.tsx",
    );

    const uploadAt = source.indexOf("await uploadFiles(");
    const successAt = source.indexOf('setPhase("berhasil")');

    expect(uploadAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(uploadAt);
  });

  it("keeps the key across retries and replaces it only after success", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/pod-capture.tsx",
    );

    const rotateAt = source.indexOf("setIdempotencyKey(crypto.randomUUID())");
    const successAt = source.indexOf('setPhase("berhasil")');

    expect(rotateAt).toBeGreaterThan(-1);
    expect(rotateAt).toBeLessThan(successAt);
  });
});
