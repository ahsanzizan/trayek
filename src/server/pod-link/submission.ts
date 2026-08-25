import { type PrismaClient } from "../../../generated/prisma";
import { logger } from "~/server/observability/logger";

/**
 * Recording what a driver uploaded (TRK-030).
 *
 * Like resolution, this runs with no session: the upload link is the whole
 * authorization, so every write below is keyed by a link the caller already
 * proved it holds, and the organization is taken from that link rather than
 * from anything the client sent.
 */

/**
 * Capture attestation as the browser reported it (TRK-032).
 *
 * `capturedAt` is the client's clock and is stored beside the server's own
 * `receivedAt` rather than replacing it. The two disagreeing is a signal
 * TRK-062 can use; collapsing them into one would throw that away.
 */
export type CaptureAttestation = {
  permission: "GRANTED" | "DENIED" | "UNAVAILABLE";
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string;
};

export type OpenSubmissionInput = {
  db: PrismaClient;
  organizationId: string;
  orderId: string;
  podUploadLinkId: string;
  /** One per capture attempt, from the browser. See `PodSubmission`. */
  idempotencyKey: string;
  attestation?: CaptureAttestation | null;
};

/** Postgres unique violation, surfaced by Prisma as a known request error. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Finds the submission for this capture attempt, or opens it.
 *
 * Called when a photograph arrives, not when the upload is authorized. That
 * ordering is deliberate and it is what stops a failed upload leaving a
 * submission behind with no pages: no bytes, no row. An empty submission is
 * worse than untidy — TRK-041 triggers extraction on submission creation, so
 * an orphan would queue a job to read a POD that does not exist.
 *
 * Keyed by the client's idempotency key, so a driver whose connection dropped
 * mid-batch retries onto the same submission rather than beside it.
 */
export async function findOrOpenPodSubmission({
  db,
  organizationId,
  orderId,
  podUploadLinkId,
  idempotencyKey,
  attestation = null,
}: OpenSubmissionInput): Promise<string> {
  const existing = await db.podSubmission.findFirst({
    where: { organizationId, idempotencyKey },
    select: { id: true },
  });

  if (existing) {
    return existing.id;
  }

  try {
    const created = await db.podSubmission.create({
      data: {
        organizationId,
        orderId,
        podUploadLinkId,
        idempotencyKey,
        // A refused prompt still records its refusal. Storing nothing would
        // make "the driver said no" indistinguishable from "we never asked",
        // and only one of those is worth anything to a fraud reviewer.
        geolocationPermission: attestation?.permission ?? null,
        captureLatitude: attestation?.latitude ?? null,
        captureLongitude: attestation?.longitude ?? null,
        captureAccuracyMeters: attestation?.accuracyMeters ?? null,
        capturedAt: attestation ? new Date(attestation.capturedAt) : null,
      },
      select: { id: true },
    });

    return created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    // Two photographs of the same batch landed at once and both tried to open
    // the submission. The unique index settled it; this one reads the winner.
    const winner = await db.podSubmission.findFirst({
      where: { organizationId, idempotencyKey },
      select: { id: true },
    });

    if (!winner) {
      throw error;
    }

    return winner.id;
  }
}

/**
 * Capture quality for one photograph, as the browser measured it (TRK-031).
 *
 * Advisory: it arrives from the client and is stored for a human to read and
 * for TRK-044 to correlate against extraction accuracy. Nothing here decides
 * whether the page is written.
 */
export type PageQuality = {
  score: number | null;
  overridden: boolean;
  checks: Array<{ id: string; passed: boolean; value: number }>;
};

export type RecordPageInput = {
  db: PrismaClient;
  organizationId: string;
  podSubmissionId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /**
   * The driver's capture order, resolved by the caller from the batch it saw.
   * Null when the batch could not be matched, in which case arrival order is
   * used — wrong only if two photographs of a multi-page POD land out of
   * order, and recoverable because the page rows keep their own timestamps.
   */
  pageIndex: number | null;
  /** Null when the client sent no measurement for this photograph. */
  quality?: PageQuality | null;
};

export async function recordPodSubmissionPage({
  db,
  organizationId,
  podSubmissionId,
  storageKey,
  fileName,
  contentType,
  sizeBytes,
  pageIndex,
  quality = null,
}: RecordPageInput): Promise<string> {
  const resolvedIndex =
    pageIndex ??
    (await db.podSubmissionPage.count({ where: { podSubmissionId } }));

  // Upsert, not create: a retry re-uploads the whole batch, because the
  // UploadThing client offers no way to resume a partial transfer. The same
  // page arriving twice must replace itself rather than duplicate or throw.
  // The superseded object is left in storage — TRK-141 owns reclaiming it.
  const page = await db.podSubmissionPage.upsert({
    where: {
      podSubmissionId_pageIndex: { podSubmissionId, pageIndex: resolvedIndex },
    },
    create: {
      organizationId,
      podSubmissionId,
      pageIndex: resolvedIndex,
      storageKey,
      fileName,
      contentType,
      sizeBytes,
      qualityScore: quality?.score ?? null,
      qualityChecks: quality?.checks ?? undefined,
      qualityOverridden: quality?.overridden ?? false,
    },
    update: {
      storageKey,
      fileName,
      contentType,
      sizeBytes,
      qualityScore: quality?.score ?? null,
      qualityChecks: quality?.checks ?? undefined,
      qualityOverridden: quality?.overridden ?? false,
    },
    select: { id: true },
  });

  await rollUpSubmissionQuality({ db, podSubmissionId });

  // The page id, its index, and its score — never the storage key: the key
  // reaches the original bytes of a signed document, and a log line outlives
  // the request.
  logger.info("POD page recorded", {
    podSubmissionId,
    pageId: page.id,
    pageIndex: resolvedIndex,
    qualityScore: quality?.score ?? null,
    qualityOverridden: quality?.overridden ?? false,
    organizationId,
  });

  return page.id;
}

/**
 * Recomputes the submission-level quality rollup from its pages (TRK-031).
 *
 * The lowest page score, not an average: a three-page POD is only as readable
 * as its worst page, and averaging would let one crisp cover sheet hide the
 * blurred page the `nomor surat jalan` is actually printed on.
 *
 * Recomputed from the pages on every insert rather than accumulated, so it
 * cannot drift when uploads land out of order or one is retried.
 */
async function rollUpSubmissionQuality({
  db,
  podSubmissionId,
}: {
  db: PrismaClient;
  podSubmissionId: string;
}): Promise<void> {
  const pages = await db.podSubmissionPage.findMany({
    where: { podSubmissionId },
    select: { qualityScore: true, qualityOverridden: true },
  });

  const scores = pages
    .map((page) => page.qualityScore)
    .filter((score): score is number => score !== null);

  await db.podSubmission.updateMany({
    where: { id: podSubmissionId },
    data: {
      lowestQualityScore: scores.length > 0 ? Math.min(...scores) : null,
      qualityOverridden: pages.some((page) => page.qualityOverridden),
    },
  });
}

/**
 * Discards a submission that never received a page.
 *
 * Called when every upload in a batch failed. Deleting it is correct rather
 * than leaving it: an empty submission would trigger extraction (TRK-041) on
 * a POD that does not exist, and a failed upload is already surfaced to the
 * driver by the screen he is looking at.
 */
export async function discardEmptyPodSubmission({
  db,
  podSubmissionId,
}: {
  db: PrismaClient;
  podSubmissionId: string;
}): Promise<boolean> {
  const result = await db.podSubmission.deleteMany({
    where: { id: podSubmissionId, pages: { none: {} } },
  });

  return result.count === 1;
}
