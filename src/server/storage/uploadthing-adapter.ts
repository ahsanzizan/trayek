import { UTApi } from "uploadthing/server";
import { type UploadFileResult } from "uploadthing/types";

import {
  type PresignedGetParams,
  type PresignedPutParams,
  type PresignedUrl,
  type StoragePort,
  type StorageObjectParams,
} from "~/server/domain/ports/storage";

type UploadThingApi = Pick<
  UTApi,
  "deleteFiles" | "generateSignedURL" | "getSignedURL"
> &
  Partial<Pick<UTApi, "uploadFiles">>;
type UploadThingUploadOptions = NonNullable<
  Parameters<UTApi["uploadFiles"]>[1]
>;

const DEFAULT_DOWNLOAD_TTL_MINUTES = 5;
const DEFAULT_UPLOAD_TTL_MINUTES = 15;

function assertStorageObject(params: { organizationId: string; key: string }) {
  if (!params.organizationId.trim()) {
    throw new TypeError("organizationId must not be empty");
  }

  if (!params.key.trim()) {
    throw new TypeError("key must not be empty");
  }
}

function getTtlSeconds(expiresInMinutes: number | undefined, fallback: number) {
  const minutes = expiresInMinutes ?? fallback;

  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new RangeError("expiresInMinutes must be greater than zero");
  }

  return Math.max(1, Math.round(minutes * 60));
}

export class UploadThingStorageAdapter implements StoragePort {
  private readonly utapi: UploadThingApi;

  constructor(token?: string, utapi?: UploadThingApi) {
    this.utapi = utapi ?? (token ? new UTApi({ token }) : new UTApi());
  }

  async presignedGet(params: PresignedGetParams): Promise<PresignedUrl> {
    assertStorageObject(params);

    const ttlSeconds = getTtlSeconds(
      params.expiresInMinutes,
      DEFAULT_DOWNLOAD_TTL_MINUTES,
    );
    const response = await this.utapi.generateSignedURL(params.key, {
      expiresIn: ttlSeconds,
    });

    return {
      url: response.ufsUrl,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async presignedPut(params: PresignedPutParams): Promise<PresignedUrl> {
    assertStorageObject(params);

    if (!params.contentType.trim()) {
      throw new TypeError("contentType must not be empty");
    }

    if (
      !Number.isInteger(params.declaredContentLength) ||
      params.declaredContentLength <= 0
    ) {
      throw new RangeError("declaredContentLength must be a positive integer");
    }

    const ttlSeconds = getTtlSeconds(
      params.expiresInMinutes,
      DEFAULT_UPLOAD_TTL_MINUTES,
    );

    return {
      url: "/api/uploadthing?endpoint=podUploader",
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async delete(params: StorageObjectParams): Promise<void> {
    assertStorageObject(params);
    await this.utapi.deleteFiles(params.key);
  }

  uploadFiles(
    file: File,
    options?: UploadThingUploadOptions,
  ): Promise<UploadFileResult>;
  uploadFiles(
    files: File[],
    options?: UploadThingUploadOptions,
  ): Promise<UploadFileResult[]>;
  async uploadFiles(files: File | File[], options?: UploadThingUploadOptions) {
    if (!this.utapi.uploadFiles) {
      throw new Error("UploadThing uploadFiles is unavailable");
    }

    const uploadOptions = { ...options, acl: "private" as const };

    if (Array.isArray(files)) {
      return this.utapi.uploadFiles(files, uploadOptions);
    }

    return this.utapi.uploadFiles(files, uploadOptions);
  }

  async exists(params: StorageObjectParams): Promise<boolean> {
    assertStorageObject(params);

    try {
      // generateSignedURL is local-only in v7 and cannot prove the key exists.
      const response = await this.utapi.getSignedURL(params.key);

      return Boolean(response.ufsUrl);
    } catch {
      return false;
    }
  }
}
