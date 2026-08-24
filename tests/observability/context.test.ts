import { describe, expect, it } from "vitest";

import {
  createObservabilityContext,
  getObservabilityContext,
  requestIdFromHeaders,
  runWithObservabilityContext,
  withOrganizationContext,
} from "~/server/observability/context";

describe("observability context", () => {
  it("accepts safe request IDs and replaces unsafe headers", () => {
    expect(
      requestIdFromHeaders(new Headers({ "x-request-id": "client-123" })),
    ).toBe("client-123");

    const generated = requestIdFromHeaders(
      new Headers({ "x-request-id": "contains spaces and secrets" }),
    );

    expect(generated).not.toBe("contains spaces and secrets");
    expect(generated).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("keeps nested organization enrichment scoped to the continuation", async () => {
    const context = createObservabilityContext("request-1");

    await runWithObservabilityContext(context, async () => {
      expect(getObservabilityContext()).toEqual({
        requestId: "request-1",
        organizationId: null,
      });

      await withOrganizationContext("org-a", async () => {
        expect(getObservabilityContext()).toEqual({
          requestId: "request-1",
          organizationId: "org-a",
        });
      });

      expect(getObservabilityContext().organizationId).toBeNull();
    });
  });

  it("isolates concurrent requests and never shares tenant state", async () => {
    const values = await Promise.all(
      ["a", "b"].map((suffix) =>
        runWithObservabilityContext(
          createObservabilityContext(`request-${suffix}`),
          async () => {
            await new Promise((resolve) =>
              setTimeout(resolve, suffix === "a" ? 5 : 1),
            );
            return withOrganizationContext(`org-${suffix}`, async () => {
              await new Promise((resolve) => setTimeout(resolve, 2));
              return getObservabilityContext();
            });
          },
        ),
      ),
    );

    expect(values).toEqual([
      { requestId: "request-a", organizationId: "org-a" },
      { requestId: "request-b", organizationId: "org-b" },
    ]);
    expect(getObservabilityContext()).toEqual({
      requestId: "unscoped",
      organizationId: null,
    });
  });
});
