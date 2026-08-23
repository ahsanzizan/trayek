import { describe, expect, it } from "vitest";

import {
  UploadButton,
  UploadDropzone,
  useUploadThing,
} from "~/lib/uploadthing";

describe("UploadThing React helpers", () => {
  it("exports typed upload helpers for the file router", () => {
    expect(useUploadThing).toEqual(expect.any(Function));
    expect(UploadButton).toEqual(expect.any(Function));
    expect(UploadDropzone).toEqual(expect.any(Function));
  });
});
