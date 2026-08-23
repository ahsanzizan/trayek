import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadThingStorageAdapter } from "~/server/storage/uploadthing-adapter";

describe("UploadThingStorageAdapter.presignedGet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates a five-minute signed URL from the UploadThing file key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T10:00:00.000Z"));

    const generateSignedURL = vi
      .fn()
      .mockResolvedValue({ ufsUrl: "https://utfs.example/signed-file" });
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL,
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedGet({
        organizationId: "org_123",
        key: "file_123",
      }),
    ).resolves.toEqual({
      url: "https://utfs.example/signed-file",
      expiresAt: new Date("2026-08-23T10:05:00.000Z"),
    });
    expect(generateSignedURL).toHaveBeenCalledWith("file_123", {
      expiresIn: 300,
    });
  });

  it("converts a custom TTL from minutes to seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T10:00:00.000Z"));

    const generateSignedURL = vi
      .fn()
      .mockResolvedValue({ ufsUrl: "https://utfs.example/signed-file" });
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL,
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedGet({
        organizationId: "org_123",
        key: "file_123",
        expiresInMinutes: 2.5,
      }),
    ).resolves.toEqual({
      url: "https://utfs.example/signed-file",
      expiresAt: new Date("2026-08-23T10:02:30.000Z"),
    });
    expect(generateSignedURL).toHaveBeenCalledWith("file_123", {
      expiresIn: 150,
    });
  });

  it("keeps a positive fractional TTL at least one second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T10:00:00.000Z"));

    const generateSignedURL = vi
      .fn()
      .mockResolvedValue({ ufsUrl: "https://utfs.example/signed-file" });
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL,
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedGet({
        organizationId: "org_123",
        key: "file_123",
        expiresInMinutes: 0.001,
      }),
    ).resolves.toEqual({
      url: "https://utfs.example/signed-file",
      expiresAt: new Date("2026-08-23T10:00:01.000Z"),
    });
    expect(generateSignedURL).toHaveBeenCalledWith("file_123", {
      expiresIn: 1,
    });
  });

  it("rejects a non-positive signed URL TTL", async () => {
    const generateSignedURL = vi.fn();
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL,
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedGet({
        organizationId: "org_123",
        key: "file_123",
        expiresInMinutes: 0,
      }),
    ).rejects.toThrow(RangeError);
    expect(generateSignedURL).not.toHaveBeenCalled();
  });

  it("rejects an empty storage key before calling UploadThing", async () => {
    const generateSignedURL = vi.fn();
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL,
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedGet({
        organizationId: "org_123",
        key: "  ",
      }),
    ).rejects.toThrow("key must not be empty");
    expect(generateSignedURL).not.toHaveBeenCalled();
  });
});

describe("UploadThingStorageAdapter.presignedPut", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the UploadThing POD route with a fifteen-minute expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T10:00:00.000Z"));

    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL: vi.fn(),
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedPut({
        organizationId: "org_123",
        key: "file_123",
        contentType: "image/jpeg",
        declaredContentLength: 1024,
      }),
    ).resolves.toEqual({
      url: "/api/uploadthing?endpoint=podUploader",
      expiresAt: new Date("2026-08-23T10:15:00.000Z"),
    });
  });

  it("rejects an invalid declared content length", async () => {
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL: vi.fn(),
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedPut({
        organizationId: "org_123",
        key: "file_123",
        contentType: "image/jpeg",
        declaredContentLength: 0,
      }),
    ).rejects.toThrow("declaredContentLength");
  });

  it("rejects an empty content type", async () => {
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL: vi.fn(),
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.presignedPut({
        organizationId: "org_123",
        key: "file_123",
        contentType: " ",
        declaredContentLength: 1024,
      }),
    ).rejects.toThrow("contentType must not be empty");
  });
});

describe("UploadThingStorageAdapter.delete", () => {
  it("delegates deletion to UploadThing with the file key", async () => {
    const deleteFiles = vi.fn().mockResolvedValue({ success: true });
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL: vi.fn(),
      deleteFiles,
      getSignedURL: vi.fn(),
    });

    await expect(
      adapter.delete({ organizationId: "org_123", key: "file_123" }),
    ).resolves.toBeUndefined();
    expect(deleteFiles).toHaveBeenCalledWith("file_123");
  });
});

describe("UploadThingStorageAdapter.uploadFiles", () => {
  it("uploads server-generated files with a private ACL", async () => {
    const uploadFiles = vi.fn().mockResolvedValue({
      data: {
        key: "invoice_123",
        name: "invoice.pdf",
        size: 1024,
        type: "application/pdf",
        ufsUrl: "https://utfs.example/invoice_123",
      },
      error: null,
    });
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL: vi.fn(),
      deleteFiles: vi.fn(),
      getSignedURL: vi.fn(),
      uploadFiles,
    });
    const file = new File(["invoice"], "invoice.pdf", {
      type: "application/pdf",
    });

    await expect(adapter.uploadFiles(file)).resolves.toMatchObject({
      data: { key: "invoice_123" },
    });
    expect(uploadFiles).toHaveBeenCalledWith(file, { acl: "private" });
  });
});

describe("UploadThingStorageAdapter.exists", () => {
  it("returns true when UploadThing can retrieve a signed URL", async () => {
    const getSignedURL = vi.fn().mockResolvedValue({
      url: "https://utfs.example/signed-file",
      ufsUrl: "https://utfs.example/signed-file",
    });
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL: vi.fn(),
      deleteFiles: vi.fn(),
      getSignedURL,
    });

    await expect(
      adapter.exists({ organizationId: "org_123", key: "file_123" }),
    ).resolves.toBe(true);
    expect(getSignedURL).toHaveBeenCalledWith("file_123");
  });

  it("returns false when UploadThing rejects the signed URL request", async () => {
    const getSignedURL = vi.fn().mockRejectedValue(new Error("file not found"));
    const adapter = new UploadThingStorageAdapter(undefined, {
      generateSignedURL: vi.fn(),
      deleteFiles: vi.fn(),
      getSignedURL,
    });

    await expect(
      adapter.exists({ organizationId: "org_123", key: "missing_file" }),
    ).resolves.toBe(false);
  });
});
