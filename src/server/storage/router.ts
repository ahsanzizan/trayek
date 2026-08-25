import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import {
  consumeUploadLinkUse,
  resolveUploadLink,
} from "~/server/pod-link/resolve";
import {
  openPodSubmission,
  type PageQuality,
  recordPodSubmissionPage,
} from "~/server/pod-link/submission";

type QualityForFile = PageQuality;
import {
  createObservabilityContext,
  getObservabilityContext,
  requestIdFromHeaders,
  runWithObservabilityContext,
} from "~/server/observability/context";
import { reporter } from "~/server/observability/reporter";

const f = createUploadthing();

/**
 * A driver POD upload carries its upload token and nothing else (TRK-030).
 *
 * `organizationId` and `loadId` used to arrive here from the client, with the
 * driver token optional and never checked — which meant any caller could
 * upload against any organization. Both are now derived from the token, so
 * the client no longer names the tenant it is writing to.
 */
/**
 * Capture quality as the browser measured it (TRK-031).
 *
 * Client-supplied and therefore forgeable. It is recorded so a human can see
 * why a POD was hard to read, and so TRK-044 can correlate quality against
 * extraction accuracy. It must never gate a write or authorize anything —
 * a driver who fakes a perfect score gains nothing, which is the point.
 */
const qualityCheckInput = z.object({
  id: z.enum(["RESOLUTION", "BLUR", "BRIGHTNESS", "DOCUMENT_COVERAGE"]),
  passed: z.boolean(),
  value: z.number().finite(),
});

const qualityInput = z.object({
  fileName: z.string().min(1).max(300),
  /** Null when the browser could not decode the photograph to measure it. */
  score: z.number().int().min(0).max(100).nullable(),
  overridden: z.boolean(),
  checks: z.array(qualityCheckInput).max(8),
});

export const podUploadInput = z.object({
  token: z.string().min(1).max(64),
  quality: z.array(qualityInput).max(6).optional(),
});

export const invoiceUploadInput = z.object({
  organizationId: z.string().min(1),
});

export interface UploadThingFileMetadata {
  type: string;
  size: number;
}

const MAX_POD_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_POD_PDF_BYTES = 10 * 1024 * 1024;

function rejectUploadThingError(message: string): Promise<never> {
  const error: Error = new UploadThingError({
    code: "TOO_LARGE",
    message,
  });

  return Promise.reject(error);
}

/**
 * Refuses an upload the caller is not allowed to make.
 *
 * Separate from `rejectUploadThingError`, which means "too large". Reusing
 * that one for an authorization failure reported a dead link as HTTP 413
 * Payload Too Large, which sent a real diagnosis down the wrong path.
 */
function rejectUnauthorized(message: string): Promise<never> {
  const error: Error = new UploadThingError({
    code: "FORBIDDEN",
    message,
  });

  return Promise.reject(error);
}

export async function validatePodFileSizes(
  files: readonly UploadThingFileMetadata[],
): Promise<void> {
  for (const file of files) {
    if (file.type.startsWith("image/") && file.size > MAX_POD_IMAGE_BYTES) {
      return rejectUploadThingError("POD image files must be 8MB or smaller");
    }

    if (file.type === "application/pdf" && file.size > MAX_POD_PDF_BYTES) {
      return rejectUploadThingError("POD PDF files must be 10MB or smaller");
    }
  }
}

export function logUploadError(
  fileKey: string | undefined,
  error: Error,
  request?: Request,
): void {
  const currentContext = getObservabilityContext();
  const requestId =
    currentContext.requestId !== "unscoped"
      ? currentContext.requestId
      : request
        ? requestIdFromHeaders(request.headers)
        : currentContext.requestId;

  runWithObservabilityContext(createObservabilityContext(requestId), () =>
    reporter.reportError(error, "UploadThing upload failed", { fileKey }),
  );
}

/**
 * The client address as seen through a proxy, for the per-IP throttle the
 * upload shares with link resolution (TRK-024).
 */
function clientAddress(request: Request | undefined): string | null {
  if (!request) {
    return null;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();

  return first ?? request.headers.get("x-real-ip");
}

/**
 * Authorizes a driver POD upload against its link, and opens the submission
 * the photographs will attach to (TRK-030).
 *
 * The token is resolved server-side, so the organization and the order come
 * from the link rather than from the request body. A token that is expired,
 * revoked, exhausted, unknown, or throttled never reaches storage.
 */
export async function authorizePodUpload({
  input,
  files,
  req,
}: {
  input: z.infer<typeof podUploadInput>;
  files: readonly { name: string }[];
  req?: Request;
}): Promise<{
  organizationId: string;
  orderId: string;
  podUploadLinkId: string;
  podSubmissionId: string;
  pageIndexByName: Record<string, number>;
  qualityByName: Record<string, QualityForFile>;
}> {
  const resolved = await resolveUploadLink({
    db,
    token: input.token,
    ipAddress: clientAddress(req),
  });

  if (!resolved.ok) {
    // The driver already sees the Indonesian reason on his screen; this
    // message is for the network tab, and it deliberately says nothing about
    // which links exist.
    return rejectUnauthorized("Tautan unggah tidak berlaku");
  }

  const { link } = resolved;

  // Spending the use here rather than on completion: the budget exists to cap
  // what a leaked link can do, and a link that has started six uploads has
  // already spent them whether or not the bytes arrive.
  const spent = await consumeUploadLinkUse({
    db,
    linkId: link.linkId,
    useBudget: link.useBudget,
  });

  if (!spent) {
    return rejectUnauthorized("Tautan unggah tidak berlaku");
  }

  const podSubmissionId = await openPodSubmission({
    db,
    organizationId: link.organizationId,
    orderId: link.orderId,
    podUploadLinkId: link.linkId,
  });

  // The batch is the only place capture order is visible: UploadThing calls
  // `onUploadComplete` once per file, in whatever order they land.
  const pageIndexByName: Record<string, number> = {};

  files.forEach((file, index) => {
    pageIndexByName[file.name] ??= index;
  });

  const qualityByName: Record<string, QualityForFile> = {};

  for (const entry of input.quality ?? []) {
    qualityByName[entry.fileName] = {
      score: entry.score,
      overridden: entry.overridden,
      checks: entry.checks,
    };
  }

  return {
    organizationId: link.organizationId,
    orderId: link.orderId,
    podUploadLinkId: link.linkId,
    podSubmissionId,
    pageIndexByName,
    qualityByName,
  };
}

export async function authorizeInvoiceUpload({
  input,
}: {
  input: z.infer<typeof invoiceUploadInput>;
}): Promise<{ organizationId: string; uploadedBy: string }> {
  const session = await auth();

  if (!session?.user?.id) {
    return rejectUploadThingError("You must be signed in to upload invoices");
  }

  const isMember =
    session.user.activeOrganizationId === input.organizationId ||
    session.memberships.some((m) => m.organizationId === input.organizationId);

  if (!isMember) {
    return rejectUploadThingError(
      "You do not have access to upload documents for this organization",
    );
  }

  return {
    organizationId: input.organizationId,
    uploadedBy: session.user.id,
  };
}

export const uploadRouter = {
  podUploader: f({
    image: {
      maxFileSize: "8MB",
      maxFileCount: 6,
      acl: "private",
    },
    pdf: {
      // UploadThing only accepts power-of-two route ceilings; middleware enforces 10MB.
      maxFileSize: "16MB",
      maxFileCount: 6,
      acl: "private",
    },
  })
    .input(podUploadInput)
    .middleware(async ({ input, files, req }) => {
      await validatePodFileSizes(files);

      return authorizePodUpload({ input, files, req });
    })
    .onUploadError(({ error, fileKey, req }) => {
      logUploadError(fileKey, error, req);
    })
    .onUploadComplete(async ({ metadata, file }) => {
      await recordPodSubmissionPage({
        db,
        organizationId: metadata.organizationId,
        podSubmissionId: metadata.podSubmissionId,
        storageKey: file.key,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        pageIndex: metadata.pageIndexByName[file.name] ?? null,
        quality: metadata.qualityByName[file.name] ?? null,
      });

      return {
        podSubmissionId: metadata.podSubmissionId,
        orderId: metadata.orderId,
        uploadedAt: new Date().toISOString(),
      };
    }),

  invoiceUploader: f({
    pdf: {
      maxFileSize: "16MB",
      maxFileCount: 5,
      acl: "private",
    },
  })
    .input(invoiceUploadInput)
    .middleware(async ({ input }) => authorizeInvoiceUpload({ input }))
    .onUploadError(({ error, fileKey, req }) => {
      logUploadError(fileKey, error, req);
    })
    .onUploadComplete(async ({ metadata, file }) => ({
      fileKey: file.key,
      fileName: file.name,
      fileSize: file.size,
      ufsUrl: file.ufsUrl,
      organizationId: metadata.organizationId,
      uploadedAt: new Date().toISOString(),
    })),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
