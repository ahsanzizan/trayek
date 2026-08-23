import { createRouteHandler } from "uploadthing/next";

import { uploadRouter } from "~/server/storage/router";

export const { GET, POST } = createRouteHandler({
  router: uploadRouter,
});
