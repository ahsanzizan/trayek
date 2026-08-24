import { env } from "~/env";
import { PrismaClient, type Prisma } from "../../generated/prisma";
import {
  logger,
  type ObservabilityLogger,
} from "~/server/observability/logger";
import { redactString } from "~/server/observability/redact";

export const prismaLogOptions = [
  { emit: "event", level: "error" },
  { emit: "event", level: "warn" },
] satisfies Prisma.PrismaClientOptions["log"];

type PrismaLogClient = Pick<
  PrismaClient<{ log: typeof prismaLogOptions }>,
  "$on"
>;

export function attachPrismaLogHandlers(
  client: PrismaLogClient,
  observabilityLogger: ObservabilityLogger = logger,
): void {
  client.$on("warn", (event) => {
    observabilityLogger.warn("Prisma warning", {
      target: event.target,
      message: redactString(event.message),
    });
  });

  client.$on("error", (event) => {
    observabilityLogger.error("Prisma error", {
      target: event.target,
      message: redactString(event.message),
    });
  });
}

const createPrismaClient = () => {
  const client = new PrismaClient({
    log: prismaLogOptions,
  });
  attachPrismaLogHandlers(client);
  return client;
};

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
