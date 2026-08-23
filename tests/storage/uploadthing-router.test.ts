import { describe, expect, it } from "vitest";
import { extractRouterConfig } from "uploadthing/server";

import {
  invoiceUploadInput,
  uploadRouter,
  podUploadInput,
  validatePodFileSizes,
} from "~/server/storage/router";

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
});
