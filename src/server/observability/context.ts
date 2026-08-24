import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export const REQUEST_ID_HEADER = "x-request-id";

export type ObservabilityContext = {
  requestId: string;
  organizationId: string | null;
};

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UN_SCOPED_CONTEXT: ObservabilityContext = {
  requestId: "unscoped",
  organizationId: null,
};

const storage = new AsyncLocalStorage<ObservabilityContext>();

function isSafeRequestId(value: string): boolean {
  return SAFE_REQUEST_ID.test(value);
}

export function createRequestId(candidate?: string | null): string {
  const normalized = candidate?.trim();
  return normalized && isSafeRequestId(normalized) ? normalized : randomUUID();
}

export function requestIdFromHeaders(headers: Headers): string {
  return createRequestId(headers.get(REQUEST_ID_HEADER));
}

export function withRequestIdHeader(
  response: Response,
  requestId: string,
): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function createObservabilityContext(
  requestId?: string | null,
  organizationId: string | null = null,
): ObservabilityContext {
  return {
    requestId: createRequestId(requestId),
    organizationId,
  };
}

export function getObservabilityContext(): ObservabilityContext {
  return storage.getStore() ?? { ...UN_SCOPED_CONTEXT };
}

export function runWithObservabilityContext<T>(
  context: ObservabilityContext,
  callback: () => T,
): T {
  return storage.run(context, callback);
}

export function withOrganizationContext<T>(
  organizationId: string,
  callback: () => T,
): T {
  const current = getObservabilityContext();
  return runWithObservabilityContext(
    { requestId: current.requestId, organizationId },
    callback,
  );
}
