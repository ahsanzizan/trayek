import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";

const f = createUploadthing();

export const podUploadInput = z.object({
  organizationId: z.string().min(1),
  loadId: z.string().min(1),
  driverToken: z.string().min(1).optional(),
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

function logUploadError(fileKey: string | undefined, error: Error) {
  console.error("UploadThing upload failed", {
    fileKey,
    message: error.message,
  });
}

export const uploadRouter = {
  podUploader: f({
    image: {
      maxFileSize: "8MB",
      maxFileCount: 1,
      acl: "private",
    },
    pdf: {
      // UploadThing only accepts power-of-two route ceilings; middleware enforces 10MB.
      maxFileSize: "16MB",
      maxFileCount: 1,
      acl: "private",
    },
  })
    .input(podUploadInput)
    .middleware(async ({ input, files }) => {
      await validatePodFileSizes(files);

      return {
        organizationId: input.organizationId,
        loadId: input.loadId,
        uploadedBy: input.driverToken ? "driver" : "operations",
      };
    })
    .onUploadError(({ error, fileKey }) => {
      logUploadError(fileKey, error);
    })
    .onUploadComplete(async ({ metadata, file }) => ({
      fileKey: file.key,
      fileName: file.name,
      fileSize: file.size,
      ufsUrl: file.ufsUrl,
      organizationId: metadata.organizationId,
      loadId: metadata.loadId,
      uploadedAt: new Date().toISOString(),
    })),

  invoiceUploader: f({
    pdf: {
      maxFileSize: "16MB",
      maxFileCount: 5,
      acl: "private",
    },
  })
    .input(invoiceUploadInput)
    .middleware(async ({ input }) => ({
      organizationId: input.organizationId,
      uploadedBy: "operations" as const,
    }))
    .onUploadError(({ error, fileKey }) => {
      logUploadError(fileKey, error);
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
