import { describe, expect, it } from "vitest";

import { GET, POST } from "~/app/api/uploadthing/route";

describe("UploadThing App Router handler", () => {
  it("exports both GET metadata and POST upload handlers", () => {
    expect(GET).toEqual(expect.any(Function));
    expect(POST).toEqual(expect.any(Function));
  });
});
