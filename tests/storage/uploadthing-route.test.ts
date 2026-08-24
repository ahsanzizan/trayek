import { describe, expect, it } from "vitest";

import { GET, POST } from "~/app/api/uploadthing/route";
import { withRequestIdHeader } from "~/server/observability/context";

describe("UploadThing App Router handler", () => {
  it("exports both GET metadata and POST upload handlers", () => {
    expect(GET).toEqual(expect.any(Function));
    expect(POST).toEqual(expect.any(Function));
  });

  it("returns the request correlation ID to callers", () => {
    const response = withRequestIdHeader(new Response("ok"), "upload-1");

    expect(response.headers.get("x-request-id")).toBe("upload-1");
  });
});
