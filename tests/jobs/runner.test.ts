import { describe, expect, it, vi } from "vitest";

import {
  type JobEnvelope,
  type JobTypeDefinition,
} from "~/server/domain/jobs/port";
import { runJob } from "~/server/domain/jobs/runner";

import { FakeJobStore } from "./fake-job-store";

interface PodPayload {
  podSubmissionId: string;
}

const definition: JobTypeDefinition<PodPayload> = {
  name: "test.pod-extract",
  retry: { maxAttempts: 3, initialDelaySeconds: 5, maxDelaySeconds: 300 },
  fallback: (envelope) => ({
    entityType: "PodSubmission",
    entityId: envelope.payload.podSubmissionId,
    instruction:
      "Ekstraksi POD gagal. Buka foto POD dan masukkan datanya secara manual.",
  }),
};

const envelope: JobEnvelope<PodPayload> = {
  organizationId: "org_forwarder_a",
  key: "pod-submission-1",
  payload: { podSubmissionId: "pod_1" },
};

function alwaysThrows() {
  return vi.fn().mockRejectedValue(new Error("provider unavailable"));
}

describe("runJob idempotency", () => {
  it("does not call the handler for a key that already completed", async () => {
    const store = new FakeJobStore();
    const handler = vi.fn().mockResolvedValue(undefined);

    await runJob({ definition, envelope, attempt: 1, store, handler });
    const replay = await runJob({
      definition,
      envelope,
      attempt: 1,
      store,
      handler,
    });

    expect(replay).toEqual({ status: "skipped" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("scopes the completion key to the organization", async () => {
    const store = new FakeJobStore();
    const handler = vi.fn().mockResolvedValue(undefined);

    await runJob({ definition, envelope, attempt: 1, store, handler });
    const otherTenant = await runJob({
      definition,
      envelope: { ...envelope, organizationId: "org_forwarder_b" },
      attempt: 1,
      store,
      handler,
    });

    expect(otherTenant).toEqual({ status: "completed" });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("runJob retry", () => {
  it("asks for a retry with exponential backoff while attempts remain", async () => {
    const store = new FakeJobStore();
    const handler = alwaysThrows();

    await expect(
      runJob({ definition, envelope, attempt: 1, store, handler }),
    ).resolves.toMatchObject({ status: "retry", nextDelaySeconds: 5 });
    await expect(
      runJob({ definition, envelope, attempt: 2, store, handler }),
    ).resolves.toMatchObject({ status: "retry", nextDelaySeconds: 10 });

    expect(store.deadLetters).toHaveLength(0);
    expect(store.fallbacks).toHaveLength(0);
  });

  it("does not notify anyone while a retry is still coming", async () => {
    const store = new FakeJobStore();

    await runJob({
      definition,
      envelope,
      attempt: 1,
      store,
      handler: alwaysThrows(),
    });

    expect(store.fallbacks).toHaveLength(0);
  });
});

describe("runJob terminal failure", () => {
  it("dead-letters the job and emits exactly one fallback event", async () => {
    const store = new FakeJobStore();
    const handler = alwaysThrows();

    await runJob({ definition, envelope, attempt: 1, store, handler });
    await runJob({ definition, envelope, attempt: 2, store, handler });
    const terminal = await runJob({
      definition,
      envelope,
      attempt: 3,
      store,
      handler,
    });

    expect(terminal).toMatchObject({
      status: "dead-letter",
      fallbackEmitted: true,
    });
    expect(store.deadLetters).toHaveLength(1);
    expect(store.deadLetters[0]).toMatchObject({
      organizationId: "org_forwarder_a",
      name: "test.pod-extract",
      key: "pod-submission-1",
      payload: { podSubmissionId: "pod_1" },
      error: "provider unavailable",
      attempts: 3,
    });
    expect(store.fallbacks).toHaveLength(1);
  });

  it("carries the org, the entity, and an Indonesian instruction", async () => {
    const store = new FakeJobStore();

    await runJob({
      definition,
      envelope,
      attempt: 3,
      store,
      handler: alwaysThrows(),
      now: () => new Date("2026-08-24T03:00:00.000Z"),
    });

    expect(store.fallbacks[0]).toEqual({
      organizationId: "org_forwarder_a",
      source: "test.pod-extract",
      dedupeKey: "pod-submission-1",
      entityType: "PodSubmission",
      entityId: "pod_1",
      instruction:
        "Ekstraksi POD gagal. Buka foto POD dan masukkan datanya secara manual.",
      occurredAt: new Date("2026-08-24T03:00:00.000Z"),
    });
  });

  it("emits no second event when a terminal attempt is redelivered", async () => {
    const store = new FakeJobStore();
    const handler = alwaysThrows();

    await runJob({ definition, envelope, attempt: 3, store, handler });
    const redelivered = await runJob({
      definition,
      envelope,
      attempt: 3,
      store,
      handler,
    });

    expect(redelivered).toMatchObject({
      status: "dead-letter",
      fallbackEmitted: false,
    });
    expect(store.fallbacks).toHaveLength(1);
    expect(store.deadLetters).toHaveLength(1);
  });

  it("fails terminally on the first throw when the policy allows one attempt", async () => {
    const store = new FakeJobStore();
    const once: JobTypeDefinition<PodPayload> = {
      ...definition,
      retry: { maxAttempts: 1, initialDelaySeconds: 5, maxDelaySeconds: 300 },
    };

    const outcome = await runJob({
      definition: once,
      envelope,
      attempt: 1,
      store,
      handler: alwaysThrows(),
    });

    expect(outcome).toMatchObject({ status: "dead-letter" });
    expect(store.fallbacks).toHaveLength(1);
  });

  it("normalizes a thrown non-Error so the dead letter still reads", async () => {
    const store = new FakeJobStore();

    await runJob({
      definition,
      envelope,
      attempt: 3,
      store,
      handler: vi.fn().mockRejectedValue("kaboom"),
    });

    expect(store.deadLetters[0]?.error).toBe("kaboom");
  });
});
