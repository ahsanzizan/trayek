import { describe, expect, it, vi } from "vitest";
import { extractRouterConfig } from "uploadthing/server";

import { auth } from "~/server/auth";
import {
  authorizeInvoiceUpload,
  invoiceUploadInput,
  uploadRouter,
  podUploadInput,
  validatePodFileSizes,
} from "~/server/storage/router";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

describe("UploadThing file route input validation", () => {
  it("accepts the tenant metadata required for a POD upload", () => {
    expect(
      podUploadInput.parse({
        organizationId: "org_123",
        loadId: "load_123",
        driverToken: "driver_token",
      }),
    ).toEqual({
      organizationId: "org_123",
      loadId: "load_123",
      driverToken: "driver_token",
    });
  });

  it("rejects a POD upload without organization or load metadata", () => {
    expect(() =>
      podUploadInput.parse({ organizationId: "", loadId: "load_123" }),
    ).toThrow();
    expect(() =>
      podUploadInput.parse({ organizationId: "org_123", loadId: "" }),
    ).toThrow();
  });

  it("accepts and normalizes the organization metadata for invoices", () => {
    expect(invoiceUploadInput.parse({ organizationId: "org_123" })).toEqual({
      organizationId: "org_123",
    });
  });

  it("rejects invoice uploads without organization metadata", () => {
    expect(() => invoiceUploadInput.parse({ organizationId: "" })).toThrow();
  });

  it("rejects POD PDFs above the ten-megabyte product limit", async () => {
    await expect(
      validatePodFileSizes([
        {
          type: "application/pdf",
          size: 10 * 1024 * 1024 + 1,
        },
      ]),
    ).rejects.toThrow("POD PDF files must be 10MB or smaller");
  });

  it("keeps POD and invoice routes private", () => {
    const routerConfig = extractRouterConfig(uploadRouter);
    const podRoute = routerConfig.find(({ slug }) => slug === "podUploader");
    const invoiceRoute = routerConfig.find(
      ({ slug }) => slug === "invoiceUploader",
    );

    expect(podRoute).toBeDefined();
    expect(invoiceRoute).toBeDefined();

    if (!podRoute || !invoiceRoute) {
      return;
    }

    expect(podRoute.config.image).toMatchObject({
      maxFileCount: 1,
      acl: "private",
    });
    expect(podRoute.config.pdf).toMatchObject({
      maxFileCount: 1,
      acl: "private",
    });
    expect(invoiceRoute.config.pdf).toMatchObject({
      maxFileCount: 5,
      acl: "private",
    });
  });

  it("rejects invoice upload middleware when unauthenticated", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce(
      null,
    );

    await expect(
      authorizeInvoiceUpload({ input: { organizationId: "org_123" } }),
    ).rejects.toThrow("You must be signed in to upload invoices");
  });

  it("rejects invoice upload middleware when user has no membership in organization", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce({
      user: { id: "user_1", activeOrganizationId: "org_other" },
      memberships: [{ id: "m1", organizationId: "org_other", role: "OWNER" }],
      expires: "2099-01-01T00:00:00.000Z",
    });

    await expect(
      authorizeInvoiceUpload({ input: { organizationId: "org_123" } }),
    ).rejects.toThrow(
      "You do not have access to upload documents for this organization",
    );
  });

  it("authorizes invoice upload middleware when user belongs to target organization", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValueOnce({
      user: { id: "user_1", activeOrganizationId: "org_123" },
      memberships: [{ id: "m1", organizationId: "org_123", role: "FINANCE" }],
      expires: "2099-01-01T00:00:00.000Z",
    });

    const result = await authorizeInvoiceUpload({
      input: { organizationId: "org_123" },
    });

    expect(result).toEqual({
      organizationId: "org_123",
      uploadedBy: "user_1",
    });
  });
});
