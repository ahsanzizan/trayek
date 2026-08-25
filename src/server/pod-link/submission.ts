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

export type OpenSubmissionInput = {
  db: PrismaClient;
  organizationId: string;
  orderId: string;
  podUploadLinkId: string;
};

/**
 * Opens the submission a batch of photographs will hang off.
 *
 * Created before the first byte arrives, because the pages need a parent to
 * attach to and the upload middleware is the last point that sees the batch
 * as a whole. A submission that ends up with no pages means every photograph
 * in the batch failed, which is worth being able to see.
 */
export async function openPodSubmission({
  db,
  organizationId,
  orderId,
  podUploadLinkId,
}: OpenSubmissionInput): Promise<string> {
  const submission = await db.podSubmission.create({
    data: { organizationId, orderId, podUploadLinkId },
    select: { id: true },
  });

  return submission.id;
}

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
}: RecordPageInput): Promise<string> {
  const resolvedIndex =
    pageIndex ??
    (await db.podSubmissionPage.count({ where: { podSubmissionId } }));

  const page = await db.podSubmissionPage.create({
    data: {
      organizationId,
      podSubmissionId,
      pageIndex: resolvedIndex,
      storageKey,
      fileName,
      contentType,
      sizeBytes,
    },
    select: { id: true },
  });

  // The page id and its index, never the storage key: the key reaches the
  // original bytes of a signed document, and a log line outlives the request.
  logger.info("POD page recorded", {
    podSubmissionId,
    pageId: page.id,
    pageIndex: resolvedIndex,
    organizationId,
  });

  return page.id;
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
