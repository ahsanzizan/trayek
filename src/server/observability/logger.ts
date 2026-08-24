import pino, { type DestinationStream } from "pino";

import { getObservabilityContext } from "~/server/observability/context";
import { redactValue } from "~/server/observability/redact";

export type LogFields = Record<string, unknown>;

export interface ObservabilityLogger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const pinoOptions: pino.LoggerOptions = {
  level: "info",
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["password", "token", "authorization", "cookie", "body", "payload"],
    censor: "[REDACTED]",
  },
};

function asLogFields(value: unknown): LogFields {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as LogFields;
  }

  return { context: value };
}

export function createObservabilityLogger(
  destination?: DestinationStream,
): ObservabilityLogger {
  const root = destination ? pino(pinoOptions, destination) : pino(pinoOptions);

  function write(
    level: "info" | "warn" | "error",
    message: string,
    fields?: LogFields,
  ): void {
    const context = getObservabilityContext();
    const safeFields = asLogFields(redactValue(fields ?? {}));

    root[level](
      {
        ...safeFields,
        requestId: context.requestId,
        organizationId: context.organizationId,
      },
      message,
    );
  }

  return {
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export const logger = createObservabilityLogger();
