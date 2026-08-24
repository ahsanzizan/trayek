import { JobTypeRegistry } from "~/server/domain/jobs/registry";
import { type JobHandler } from "~/server/domain/jobs/runner";

/**
 * The job types this deployment can run, and the handler for each.
 *
 * Handlers live here rather than in the domain because they do IO — they read
 * storage, call the LLM provider, write Prisma. The domain owns the type
 * definition (retry policy and fallback text); infrastructure owns the work.
 *
 * Empty on purpose: TRK-005 ships the machinery, and the first real job type
 * arrives with image preprocessing (TRK-042). Register a type here and the
 * worker picks it up on next boot — no other wiring needed.
 */
export const jobTypes = new JobTypeRegistry();

const handlers = new Map<string, JobHandler<unknown>>();

export function registerJobHandler<TPayload>(
  name: string,
  handler: JobHandler<TPayload>,
): void {
  if (!jobTypes.has(name)) {
    throw new Error(
      `Cannot register a handler for unregistered job type ${name}`,
    );
  }

  handlers.set(name, handler as JobHandler<unknown>);
}

export function jobHandler(name: string): JobHandler<unknown> {
  const handler = handlers.get(name);

  if (!handler) {
    throw new Error(`Job type ${name} has no registered handler`);
  }

  return handler;
}

/** Job types registered without a handler would never run. Fail at boot. */
export function assertEveryJobTypeHasHandler(): void {
  const missing = jobTypes.names().filter((name) => !handlers.has(name));

  if (missing.length > 0) {
    throw new Error(
      `Job types registered without a handler: ${missing.join(", ")}`,
    );
  }
}
