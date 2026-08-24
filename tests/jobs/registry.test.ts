import { describe, expect, it } from "vitest";

import { type JobTypeDefinition } from "~/server/domain/jobs/port";
import {
  DuplicateJobTypeError,
  JobTypeRegistry,
  MissingFallbackError,
  UnknownJobTypeError,
} from "~/server/domain/jobs/registry";
import { InvalidRetryPolicyError } from "~/server/domain/jobs/retry";

function definition(name: string): JobTypeDefinition<{ id: string }> {
  return {
    name,
    retry: { maxAttempts: 3, initialDelaySeconds: 5, maxDelaySeconds: 300 },
    fallback: (envelope) => ({
      entityType: "PodSubmission",
      entityId: envelope.payload.id,
      instruction: "Proses manual diperlukan.",
    }),
  };
}

describe("JobTypeRegistry", () => {
  it("resolves a registered type", () => {
    const registry = new JobTypeRegistry();
    registry.register(definition("test.one"));

    expect(registry.has("test.one")).toBe(true);
    expect(registry.get("test.one").name).toBe("test.one");
    expect(registry.names()).toEqual(["test.one"]);
  });

  it("rejects an unregistered type rather than silently accepting it", () => {
    const registry = new JobTypeRegistry();

    expect(() => registry.get("test.missing")).toThrow(UnknownJobTypeError);
  });

  it("rejects a duplicate registration", () => {
    const registry = new JobTypeRegistry();
    registry.register(definition("test.one"));

    expect(() => registry.register(definition("test.one"))).toThrow(
      DuplicateJobTypeError,
    );
  });

  it("rejects a job type with no fallback (INV-6)", () => {
    const registry = new JobTypeRegistry();
    const withoutFallback = {
      ...definition("test.silent"),
      fallback: undefined,
    } as unknown as JobTypeDefinition<{ id: string }>;

    expect(() => registry.register(withoutFallback)).toThrow(
      MissingFallbackError,
    );
    expect(registry.has("test.silent")).toBe(false);
  });

  it("rejects an unrunnable retry policy at registration", () => {
    const registry = new JobTypeRegistry();

    expect(() =>
      registry.register({
        ...definition("test.bad-policy"),
        retry: { maxAttempts: 0, initialDelaySeconds: 5, maxDelaySeconds: 300 },
      }),
    ).toThrow(InvalidRetryPolicyError);
  });
});
