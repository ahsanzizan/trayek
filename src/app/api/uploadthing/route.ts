import { createRouteHandler } from "uploadthing/next";
import { type NextRequest } from "next/server";

import { uploadRouter } from "~/server/storage/router";
import {
  createObservabilityContext,
  requestIdFromHeaders,
  runWithObservabilityContext,
  withRequestIdHeader,
} from "~/server/observability/context";

const routeHandlers = createRouteHandler({
  router: uploadRouter,
});

async function handleRequest(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const requestId = requestIdFromHeaders(request.headers);

  return runWithObservabilityContext(
    createObservabilityContext(requestId),
    async () => withRequestIdHeader(await handler(request), requestId),
  );
}

export const GET = (request: NextRequest) =>
  handleRequest(request, routeHandlers.GET);

export const POST = (request: NextRequest) =>
  handleRequest(request, routeHandlers.POST);
