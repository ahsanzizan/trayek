import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { readSource } from "../auth/read-source";
import { db } from "~/server/db";
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
 * TRK-031 acceptance criterion: a quality score is stored on every
 * `PodSubmission`, and an override is recorded alongside it.
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
      useBudget: 20,
    },
    select: { id: true },
  });

  createdLinkIds.push(link.id);
  usedBuckets.push(hashThrottleBucket("token", hashUploadToken(token)));
  return link;
}

type QualityEntry = {
  fileName: string;
  score: number | null;
  overridden: boolean;
  checks: Array<{
    id: "RESOLUTION" | "BLUR" | "BRIGHTNESS" | "DOCUMENT_COVERAGE";
    passed: boolean;
    value: number;
  }>;
};

async function uploadBatch(label: string, quality: QualityEntry[]) {
  const token = tokenFor(label);
  await createLink(token);

  const metadata = await authorizePodUpload({
    input: { token, quality, idempotencyKey: `q-${suffix}-${label}` },
    files: quality.map((entry) => ({ name: entry.fileName })),
  });

  const podSubmissionId = await findOrOpenPodSubmission({ db, ...metadata });

  createdSubmissionIds.push(podSubmissionId);

  for (const [index, entry] of quality.entries()) {
    await recordPodSubmissionPage({
      db,
      organizationId: metadata.organizationId,
      podSubmissionId,
      storageKey: `key-${suffix}-${label}-${index}`,
      fileName: entry.fileName,
      contentType: "image/jpeg",
      sizeBytes: 2048,
      pageIndex: metadata.pageIndexByName[entry.fileName] ?? null,
      quality: metadata.qualityByName[entry.fileName] ?? null,
    });
  }

  return podSubmissionId;
}

function entry(
  fileName: string,
  score: number | null,
  overridden = false,
): QualityEntry {
  return {
    fileName,
    score,
    overridden,
    checks: [{ id: "BLUR", passed: !overridden, value: score ?? 0 }],
  };
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

describe("storing a quality score", () => {
  it("keeps the score on the page it was measured from", async () => {
    const submissionId = await uploadBatch("SCORE", [entry("pod.jpg", 87)]);

    const page = await db.podSubmissionPage.findFirstOrThrow({
      where: { podSubmissionId: submissionId },
      select: { qualityScore: true, qualityChecks: true },
    });

    expect(page.qualityScore).toBe(87);
    expect(JSON.stringify(page.qualityChecks)).toContain("BLUR");
  });

  it("rolls the worst page up onto the submission", async () => {
    // A three-page POD is only as readable as its worst page. Averaging would
    // let a crisp cover sheet hide the blurred page carrying the number.
    const submissionId = await uploadBatch("ROLLUP", [
      entry("satu.jpg", 95),
      entry("dua.jpg", 41),
      entry("tiga.jpg", 88),
    ]);

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { lowestQualityScore: true },
    });

    expect(submission.lowestQualityScore).toBe(41);
  });

  it("records the override when the driver sent a warned photograph", async () => {
    const submissionId = await uploadBatch("OVERRIDE", [
      entry("bagus.jpg", 91),
      entry("buram.jpg", 22, true),
    ]);

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { qualityOverridden: true, lowestQualityScore: true },
    });

    expect(submission.qualityOverridden).toBe(true);
    expect(submission.lowestQualityScore).toBe(22);

    const warned = await db.podSubmissionPage.findFirstOrThrow({
      where: { podSubmissionId: submissionId, fileName: "buram.jpg" },
      select: { qualityOverridden: true },
    });

    expect(warned.qualityOverridden).toBe(true);
  });

  it("leaves a clean submission unflagged", async () => {
    const submissionId = await uploadBatch("CLEAN", [entry("pod.jpg", 96)]);

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { qualityOverridden: true },
    });

    expect(submission.qualityOverridden).toBe(false);
  });

  it("accepts a photograph the browser could not measure", async () => {
    // An undecodable image must still upload. Refusing it would turn an
    // advisory check into a gate, which is exactly what TRK-031 forbids.
    const submissionId = await uploadBatch("NOMEASURE", [
      entry("aneh.jpg", null),
    ]);

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { lowestQualityScore: true },
    });

    expect(submission.lowestQualityScore).toBeNull();

    expect(
      await db.podSubmissionPage.count({
        where: { podSubmissionId: submissionId },
      }),
    ).toBe(1);
  });

  it("stores a page even when no quality data was sent at all", async () => {
    const token = tokenFor("NOQUALITY");
    await createLink(token);

    const metadata = await authorizePodUpload({
      input: { token, idempotencyKey: `q-${suffix}-noquality` },
      files: [{ name: "pod.jpg" }],
    });

    const podSubmissionId = await findOrOpenPodSubmission({ db, ...metadata });

    createdSubmissionIds.push(podSubmissionId);

    await recordPodSubmissionPage({
      db,
      organizationId: metadata.organizationId,
      podSubmissionId,
      storageKey: `key-${suffix}-noquality`,
      fileName: "pod.jpg",
      contentType: "image/jpeg",
      sizeBytes: 1024,
      pageIndex: 0,
    });

    const page = await db.podSubmissionPage.findFirstOrThrow({
      where: { podSubmissionId },
      select: { qualityScore: true, qualityOverridden: true },
    });

    expect(page.qualityScore).toBeNull();
    expect(page.qualityOverridden).toBe(false);
  });
});

describe("the score is advisory, never a gate", () => {
  it("accepts the worst possible score without refusing the upload", async () => {
    const submissionId = await uploadBatch("WORST", [
      entry("payah.jpg", 0, true),
    ]);

    expect(
      await db.podSubmissionPage.count({
        where: { podSubmissionId: submissionId },
      }),
    ).toBe(1);
  });

  it("rejects a score outside 0-100 rather than storing nonsense", async () => {
    expect(() =>
      podUploadInput.parse({
        token: "TRAYEKSEEDA000000001",
        idempotencyKey: "batch-0000000001",
        quality: [
          { fileName: "a.jpg", score: 140, overridden: false, checks: [] },
        ],
      }),
    ).toThrow();
  });

  it("caps the batch so a client cannot send unbounded quality data", () => {
    const oversized = Array.from({ length: 7 }, (_, index) => ({
      fileName: `${index}.jpg`,
      score: 50,
      overridden: false,
      checks: [],
    }));

    expect(() =>
      podUploadInput.parse({
        token: "TRAYEKSEEDA000000001",
        quality: oversized,
      }),
    ).toThrow();
  });

  it("never lets the score reach an authorization decision", async () => {
    // Structural, not behavioural: authorization reads the link and nothing
    // else. If a future change makes the score gate a write, this fails.
    const source = await readSource("src/server/storage/router.ts");
    const authorize = source.slice(
      source.indexOf("export async function authorizePodUpload"),
      source.indexOf("export async function authorizeInvoiceUpload"),
    );

    const rejections = authorize.slice(authorize.indexOf("resolveUploadLink"));

    expect(rejections).not.toMatch(/if\s*\([^)]*quality[^)]*\)/i);
    expect(rejections).not.toMatch(/quality[^\n]*rejectUploadThingError/i);
  });
});

describe("the original bytes are never modified", () => {
  it("measures from a canvas copy and uploads the untouched File", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/pod-capture.tsx",
    );

    // The upload takes the File the camera produced. A canvas re-export would
    // strip the EXIF that TRK-061 reads for fraud forensics.
    expect(source).toContain("files: selected.map((item) => item.file)");
    expect(source).not.toContain("toBlob");
    expect(source).not.toContain("toDataURL");
  });

  it("discards the canvas it measured from", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/measure-photo.ts",
    );

    expect(source).not.toContain("toBlob");
    expect(source).not.toContain("toDataURL");
    expect(source).toContain("getImageData");
  });
});
