import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import {
  REQUEST_ID_HEADER,
  createObservabilityContext,
  requestIdFromHeaders,
  runWithObservabilityContext,
  withRequestIdHeader,
} from "~/server/observability/context";
import { reporter } from "~/server/observability/reporter";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest, requestId: string) => {
  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  return createTRPCContext({
    headers,
  });
};

const handler = async (req: NextRequest): Promise<Response> => {
  const requestId = requestIdFromHeaders(req.headers);

  return runWithObservabilityContext(
    createObservabilityContext(requestId),
    async () => {
      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext: () => createContext(req, requestId),
        onError: ({ path, error }) => {
          reporter.reportError(error, "tRPC request failed", {
            path: path ?? "<no-path>",
          });
        },
      });

      return withRequestIdHeader(response, requestId);
    },
  );
};

export { handler as GET, handler as POST };
