import * as Sentry from "@sentry/nextjs";
import { type NodeOptions } from "@sentry/nextjs";

import { env } from "~/env";
import { redactSentryData } from "~/server/observability/redact";

export const forwardedPinoLevels = ["info", "warn", "error"] as const;

export const serverSentryOptions = {
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  enableLogs: true,
  dataCollection: {
    userInfo: false,
    httpBodies: [],
    cookies: false,
    httpHeaders: {
      request: { deny: ["authorization", "cookie"] },
      response: { deny: ["authorization", "cookie"] },
    },
    urlQueryParams: { deny: ["phone", "token", "npwp"] },
    databaseQueryData: false,
    stackFrameVariables: false,
    genAI: { inputs: false, outputs: false },
  },
  integrations: [
    Sentry.pinoIntegration({
      log: { levels: [...forwardedPinoLevels] },
    }),
  ],
  beforeSend(event) {
    return redactSentryData(event);
  },
  beforeSendTransaction(transaction) {
    return redactSentryData(transaction);
  },
  beforeSendSpan(span) {
    return redactSentryData(span);
  },
  beforeSendLog(log) {
    return redactSentryData(log);
  },
  beforeSendMetric(metric) {
    return redactSentryData(metric);
  },
  beforeBreadcrumb(breadcrumb) {
    return redactSentryData(breadcrumb);
  },
} satisfies NodeOptions;

Sentry.init(serverSentryOptions);
