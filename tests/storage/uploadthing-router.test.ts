import { describe, expect, it, vi } from "vitest";
import { extractRouterConfig } from "uploadthing/server";

import { auth } from "~/server/auth";
import { reporter } from "~/server/observability/reporter";
import {
  authorizeInvoiceUpload,
  invoiceUploadInput,
  logUploadError,
  uploadRouter,
  podUploadInput,
  validatePodFileSizes,
} from "~/server/storage/router";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("~/server/observability/reporter", () => ({
  reporter: { reportError: vi.fn() },
}));

describe("UploadThing file route input validation", () => {
  it("accepts the upload token, which is all a POD upload carries", () => {
    expect(podUploadInput.parse({ token: "TRAYEKSEEDA000000001" })).toEqual({
      token: "TRAYEKSEEDA000000001",
    });
  });

  it("rejects a POD upload with no token", () => {
    expect(() => podUploadInput.parse({})).toThrow();
    expect(() => podUploadInput.parse({ token: "" })).toThrow();
  });

  it("gives the caller no way to name the tenant it writes to", () => {
    // TRK-030 moved this: `organizationId` and `loadId` used to arrive from
    // the client with the driver token optional and unchecked, so any caller
    // could upload against any organization. Both are now derived from the
    // token server-side, and anything else the client sends is dropped here.
    const parsed = podUploadInput.parse({
      token: "TRAYEKSEEDA000000001",
      organizationId: "org-forwarder-b",
      loadId: "order-b-only",
    });

    expect(parsed).toEqual({ token: "TRAYEKSEEDA000000001" });
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed).not.toHaveProperty("loadId");
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

    // A multi-page POD is several captures of one document (TRK-030), so the
    // count is above one by design. `private` is the part that must not move:
    // a POD carries a signature, and a public object is a UU PDP incident.
    expect(podRoute.config.image).toMatchObject({
      maxFileCount: 6,
      acl: "private",
    });
    expect(podRoute.config.pdf).toMatchObject({
      maxFileCount: 6,
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

  it("reports upload callback failures without inventing a tenant", () => {
    logUploadError(
      "file-key",
      new Error("upload failed for +6281234567890"),
      new Request("https://example.test/upload", {
        headers: { "x-request-id": "upload-1" },
      }),
    );

    expect(reporter.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "upload failed for +6281234567890" }),
      "UploadThing upload failed",
      { fileKey: "file-key" },
    );
  });
});
