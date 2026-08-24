import { describe, expect, it, vi } from "vitest";

import {
  type JobEnvelope,
  type JobTypeDefinition,
} from "~/server/domain/jobs/port";
import { JobTypeRegistry } from "~/server/domain/jobs/registry";
import { runJob } from "~/server/domain/jobs/runner";

import { FakeJobStore } from "../jobs/fake-job-store";

/**
 * INV-6: every agent failure produces a human-visible notification. Silent
 * failure is a defect of the highest severity.
 *
 * Covers the queue path (TRK-005). Extend this file as each new agent entry
 * point lands; TRK-143 adds the registry that makes the coverage exhaustive.
 */

const definition: JobTypeDefinition<{ podSubmissionId: string }> = {
  name: "test.pod-extract",
  retry: { maxAttempts: 2, initialDelaySeconds: 1, maxDelaySeconds: 10 },
  fallback: (envelope) => ({
    entityType: "PodSubmission",
    entityId: envelope.payload.podSubmissionId,
    instruction:
      "Ekstraksi POD gagal. Buka foto POD dan masukkan datanya secara manual.",
  }),
};

const envelope: JobEnvelope<{ podSubmissionId: string }> = {
  organizationId: "org_forwarder_a",
  key: "pod-submission-1",
  payload: { podSubmissionId: "pod_1" },
};

async function exhaustRetries(store: FakeJobStore) {
  const handler = vi.fn().mockRejectedValue(new Error("provider unavailable"));

  for (let attempt = 1; attempt <= definition.retry.maxAttempts; attempt += 1) {
    await runJob({ definition, envelope, attempt, store, handler });
  }
}

describe("INV-6: Agent failures require human-visible notification", () => {
  it("produces a notification when a job exhausts its retries", async () => {
    const store = new FakeJobStore();

    await exhaustRetries(store);

    expect(store.fallbacks).toHaveLength(1);
    expect(store.fallbacks[0]?.organizationId).toBe("org_forwarder_a");
  });

  it("never dead-letters a job without notifying a person", async () => {
    const store = new FakeJobStore();

    await exhaustRetries(store);

    expect(store.deadLetters).not.toHaveLength(0);
    for (const deadLetter of store.deadLetters) {
      const notified = store.fallbacks.some(
        (fallback) =>
          fallback.organizationId === deadLetter.organizationId &&
          fallback.dedupeKey === deadLetter.key,
      );

      expect(notified).toBe(true);
    }
  });

  it("tells the reader what to do by hand, in Bahasa Indonesia", async () => {
    const store = new FakeJobStore();

    await exhaustRetries(store);

    const instruction = store.fallbacks[0]?.instruction ?? "";
    expect(instruction.length).toBeGreaterThan(0);
    expect(instruction).toContain("manual");
  });

  it("rejects a job type that could fail without a fallback", () => {
    const registry = new JobTypeRegistry();
    const silent = {
      ...definition,
      name: "test.silent",
      fallback: undefined,
    } as unknown as JobTypeDefinition<{ podSubmissionId: string }>;

    expect(() => registry.register(silent)).toThrow(
      /human-visible notification/,
    );
  });

  it("surfaces a store failure rather than losing the notification", async () => {
    const store = new FakeJobStore();
    vi.spyOn(store, "recordHumanFallback").mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      runJob({
        definition,
        envelope,
        attempt: definition.retry.maxAttempts,
        store,
        handler: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      }),
    ).rejects.toThrow("database unavailable");
  });
});
