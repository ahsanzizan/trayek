import { type JobTypeDefinition } from "~/server/domain/jobs/port";
import { assertValidRetryPolicy } from "~/server/domain/jobs/retry";

export class UnknownJobTypeError extends Error {
  constructor(name: string) {
    super(`Job type ${name} is not registered`);
    this.name = "UnknownJobTypeError";
  }
}

export class DuplicateJobTypeError extends Error {
  constructor(name: string) {
    super(`Job type ${name} is already registered`);
    this.name = "DuplicateJobTypeError";
  }
}

export class MissingFallbackError extends Error {
  constructor(name: string) {
    super(
      `Job type ${name} must declare a fallback: every agent failure needs a human-visible notification (INV-6)`,
    );
    this.name = "MissingFallbackError";
  }
}

/**
 * The set of job types the worker knows how to run. Registration is what makes
 * a type sendable, and it fails closed: a type with no fallback cannot be
 * registered, so no job can reach a terminal failure that nobody is told about.
 */
export class JobTypeRegistry {
  private readonly definitions = new Map<string, JobTypeDefinition<unknown>>();

  register<TPayload>(definition: JobTypeDefinition<TPayload>): void {
    if (this.definitions.has(definition.name)) {
      throw new DuplicateJobTypeError(definition.name);
    }

    if (typeof definition.fallback !== "function") {
      throw new MissingFallbackError(definition.name);
    }

    assertValidRetryPolicy(definition.retry);

    // A registry of differently-typed payloads is heterogeneous by nature.
    // This is the one place that erasure happens; the worker validates the
    // envelope shape before dispatching to a handler.
    this.definitions.set(
      definition.name,
      definition as JobTypeDefinition<unknown>,
    );
  }

  get(name: string): JobTypeDefinition<unknown> {
    const definition = this.definitions.get(name);

    if (!definition) {
      throw new UnknownJobTypeError(name);
    }

    return definition;
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  names(): string[] {
    return [...this.definitions.keys()];
  }
}
