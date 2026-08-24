import * as Sentry from "@sentry/nextjs";

import { getObservabilityContext } from "~/server/observability/context";
import {
  logger as defaultLogger,
  type LogFields,
  type ObservabilityLogger,
} from "~/server/observability/logger";
import { redactErrorValue, redactValue } from "~/server/observability/redact";

export type ReportMetadata = {
  event: string;
  requestId: string;
  organizationId: string | null;
  fields: LogFields;
};

export type CaptureException = (
  error: unknown,
  metadata: ReportMetadata,
) => void;

export type ReporterDependencies = {
  logger?: ObservabilityLogger;
  captureException?: CaptureException;
};

export interface Reporter {
  reportError(error: unknown, event: string, fields?: LogFields): void;
}

function asLogFields(value: unknown): LogFields {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as LogFields;
  }

  return { context: value };
}

const captureExceptionWithSentry: CaptureException = (error, metadata) => {
  Sentry.withScope((scope) => {
    scope.setTag("request_id", metadata.requestId);
    scope.setTag("organization_id", metadata.organizationId ?? "unknown");
    scope.setContext("observability", metadata.fields);
    Sentry.captureException(error);
  });
};

export function createReporter(
  dependencies: ReporterDependencies = {},
): Reporter {
  const logger = dependencies.logger ?? defaultLogger;
  const captureException =
    dependencies.captureException ?? captureExceptionWithSentry;

  return {
    reportError(error, event, fields = {}) {
      const context = getObservabilityContext();
      const safeFields = asLogFields(redactValue(fields));
      const safeError = redactErrorValue(error);
      const metadata: ReportMetadata = {
        event,
        requestId: context.requestId,
        organizationId: context.organizationId,
        fields: safeFields,
      };

      try {
        logger.error(event, {
          ...safeFields,
          error: safeError,
          requestId: context.requestId,
          organizationId: context.organizationId,
        });
      } catch {
        // Observability must never change the primary failure path.
      }

      try {
        captureException(error, metadata);
      } catch {
        // The local structured record remains the best-effort fallback.
      }
    },
  };
}

export const reporter = createReporter();
