import { afterAll, describe, expect, it } from "vitest";

import { seedFixturesData } from "../../prisma/seed";
import { readSource } from "../auth/read-source";
import { db } from "~/server/db";
import {
  classifyGeolocationError,
  unavailableAttestation,
} from "~/app/(driver)/pod/[token]/_components/capture-location";
import {
  hashThrottleBucket,
  hashUploadToken,
} from "~/server/domain/pod-link/token";
import { findOrOpenPodSubmission } from "~/server/pod-link/submission";
import { authorizePodUpload, podUploadInput } from "~/server/storage/router";

/**
 * TRK-032 acceptance criteria: a denied permission still uploads, and the
 * permission state and coordinates are persisted for fraud detection.
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

type Attestation = {
  permission: "GRANTED" | "DENIED" | "UNAVAILABLE";
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string;
};

/** Tanjung Priok, which is where a Jakarta POD would plausibly be captured. */
const PRIOK: Attestation = {
  permission: "GRANTED",
  latitude: -6.1045,
  longitude: 106.8829,
  accuracyMeters: 18.5,
  capturedAt: "2026-08-25T09:15:00.000Z",
};

async function upload(label: string, attestation?: Attestation) {
  const token = tokenFor(label);
  await createLink(token);

  const metadata = await authorizePodUpload({
    input: { token, attestation, idempotencyKey: `att-${suffix}-${label}` },
    files: [{ name: "pod.jpg" }],
  });

  // Authorization no longer opens a submission (TRK-033); the upload path
  // does it when the first photograph arrives.
  const submissionId = await findOrOpenPodSubmission({ db, ...metadata });

  createdSubmissionIds.push(submissionId);
  return submissionId;
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

describe("classifying what the browser said", () => {
  it("separates a refusal from an inability", () => {
    // Only PERMISSION_DENIED says anything about the driver. A timeout or an
    // unavailable position says something about the warehouse roof.
    expect(classifyGeolocationError(1)).toBe("DENIED");
    expect(classifyGeolocationError(2)).toBe("UNAVAILABLE");
    expect(classifyGeolocationError(3)).toBe("UNAVAILABLE");
  });

  it("treats an unrecognised code as unavailable, never as refusal", () => {
    expect(classifyGeolocationError(99)).toBe("UNAVAILABLE");
  });

  it("stamps a client clock even when there is no fix", () => {
    const attestation = unavailableAttestation("DENIED");

    expect(attestation.permission).toBe("DENIED");
    expect(attestation.latitude).toBeNull();
    expect(Date.parse(attestation.capturedAt)).not.toBeNaN();
  });
});

describe("persisting the attestation", () => {
  it("stores coordinates, accuracy, and the client clock", async () => {
    const submissionId = await upload("GRANTED", PRIOK);

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: {
        geolocationPermission: true,
        captureLatitude: true,
        captureLongitude: true,
        captureAccuracyMeters: true,
        capturedAt: true,
        receivedAt: true,
      },
    });

    expect(submission.geolocationPermission).toBe("GRANTED");
    expect(submission.captureLatitude).toBeCloseTo(-6.1045, 4);
    expect(submission.captureLongitude).toBeCloseTo(106.8829, 4);
    expect(submission.captureAccuracyMeters).toBeCloseTo(18.5, 1);
    expect(submission.capturedAt?.toISOString()).toBe(PRIOK.capturedAt);
  });

  it("keeps the client clock separate from the server clock", async () => {
    // The two disagreeing is the signal. Collapsing them into one field would
    // throw away the only evidence that a phone clock was wrong or set.
    const submissionId = await upload("CLOCKS", PRIOK);

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { capturedAt: true, receivedAt: true },
    });

    expect(submission.capturedAt).not.toBeNull();
    expect(submission.receivedAt.getTime()).toBeGreaterThan(
      submission.capturedAt?.getTime() ?? 0,
    );
  });

  it("records a refusal as a refusal, not as an absence", async () => {
    const submissionId = await upload("DENIED", {
      permission: "DENIED",
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      capturedAt: "2026-08-25T09:20:00.000Z",
    });

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { geolocationPermission: true, captureLatitude: true },
    });

    // "The driver said no" and "we never asked" must not look the same.
    expect(submission.geolocationPermission).toBe("DENIED");
    expect(submission.captureLatitude).toBeNull();
  });

  it("records an unavailable fix distinctly from a refusal", async () => {
    const submissionId = await upload("NOFIX", {
      permission: "UNAVAILABLE",
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      capturedAt: "2026-08-25T09:25:00.000Z",
    });

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { geolocationPermission: true },
    });

    expect(submission.geolocationPermission).toBe("UNAVAILABLE");
  });

  it("leaves the columns null when no attestation was sent at all", async () => {
    const submissionId = await upload("NONE");

    const submission = await db.podSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { geolocationPermission: true, capturedAt: true },
    });

    expect(submission.geolocationPermission).toBeNull();
    expect(submission.capturedAt).toBeNull();
  });
});

describe("a denied permission never blocks the upload", () => {
  it("authorizes and opens a submission exactly as a granted one does", async () => {
    const denied = await upload("STILLOK", {
      permission: "DENIED",
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      capturedAt: "2026-08-25T09:30:00.000Z",
    });

    expect(
      await db.podSubmission.findUnique({ where: { id: denied } }),
    ).not.toBeNull();
  });

  it("never lets the attestation reach an authorization decision", async () => {
    // Structural, matching the guard on the quality score. If a future change
    // makes a missing location refuse an upload, this fails.
    const source = await readSource("src/server/storage/router.ts");
    const authorize = source.slice(
      source.indexOf("export async function authorizePodUpload"),
      source.indexOf("export async function authorizeInvoiceUpload"),
    );

    expect(authorize).not.toMatch(/if\s*\([^)]*attestation[^)]*\)/i);
    expect(authorize).not.toMatch(/attestation[^\n]*rejectUnauthorized/i);
  });
});

describe("what the input will accept", () => {
  it("rejects coordinates outside the possible range", () => {
    for (const bad of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: -91, longitude: 0 },
    ]) {
      expect(() =>
        podUploadInput.parse({
          token: "TRAYEKSEEDA000000001",
          idempotencyKey: "batch-0000000001",
          attestation: {
            permission: "GRANTED",
            accuracyMeters: 10,
            capturedAt: "2026-08-25T09:00:00.000Z",
            ...bad,
          },
        }),
      ).toThrow();
    }
  });

  it("rejects a negative accuracy, which is not a radius", () => {
    expect(() =>
      podUploadInput.parse({
        token: "TRAYEKSEEDA000000001",
        idempotencyKey: "batch-0000000001",
        attestation: { ...PRIOK, accuracyMeters: -5 },
      }),
    ).toThrow();
  });

  it("accepts a plausible Indonesian position", () => {
    expect(
      podUploadInput.parse({
        token: "TRAYEKSEEDA000000001",
        idempotencyKey: "batch-0000000001",
        attestation: PRIOK,
      }).attestation?.latitude,
    ).toBeCloseTo(-6.1045, 4);
  });
});

describe("the consent notice", () => {
  it("is on screen before the browser is ever asked", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/pod-capture.tsx",
    );

    // The notice is rendered unconditionally; the prompt fires only when the
    // first photograph is added. A driver who has not read why would refuse.
    const noticeAt = source.indexOf("meminta izin lokasi");
    const requestAt = source.indexOf("void captureLocation()");

    expect(noticeAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(-1);
    expect(source).toContain("Anda boleh menolak");
  });

  it("says nothing in English", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/pod-capture.tsx",
    );

    const notice = source.slice(
      source.indexOf("Saat Anda menambahkan foto"),
      source.indexOf("seperti biasa.") + 14,
    );

    expect(notice).not.toMatch(
      /\b(location|permission|allow|deny|photo|upload)\b/i,
    );
  });

  it("tells the driver refusal is allowed, which is the UU PDP basis", async () => {
    const source = await readSource(
      "src/app/(driver)/pod/[token]/_components/pod-capture.tsx",
    );

    // Consent that cannot be refused is not consent. The wording still needs
    // counsel's review against the TRK-140 notice; that AC stays open.
    expect(source).toContain("boleh menolak");
    expect(source).toContain("tetap bisa dikirim");
  });
});
