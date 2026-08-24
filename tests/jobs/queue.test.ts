import { type PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import { type JobTypeDefinition } from "~/server/domain/jobs/port";
import { JobTypeRegistry } from "~/server/domain/jobs/registry";
import { PgBossJobQueue, queueOptionsFor } from "~/server/jobs/queue";

function registryWith(name: string) {
  const registry = new JobTypeRegistry();
  const definition: JobTypeDefinition<{ id: string }> = {
    name,
    retry: { maxAttempts: 3, initialDelaySeconds: 5, maxDelaySeconds: 300 },
    fallback: () => ({
      entityType: "PodSubmission",
      entityId: null,
      instruction: "Proses manual diperlukan.",
    }),
  };
  registry.register(definition);

  return registry;
}

function fakeBoss() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    createQueue: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue("job-id"),
    getQueue: vi.fn().mockResolvedValue({
      readyCount: 4,
      queuedCount: 9,
      activeCount: 2,
      failedCount: 1,
    }),
  };
}

function queueWith(boss: ReturnType<typeof fakeBoss>, name: string) {
  return new PgBossJobQueue(boss as unknown as PgBoss, registryWith(name));
}

describe("queueOptionsFor", () => {
  it("converts maxAttempts into a pg-boss retry limit", () => {
    const registry = registryWith("test.one");

    expect(queueOptionsFor(registry.get("test.one"))).toEqual({
      name: "test.one",
      // 3 attempts total = the first run plus 2 retries.
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 300,
    });
  });
});

describe("PgBossJobQueue start", () => {
  it("opens the connection before enqueueing", async () => {
    const boss = fakeBoss();

    await queueWith(boss, "test.one").send("test.one", {
      organizationId: "org_a",
      key: "k1",
      payload: { id: "1" },
    });

    expect(boss.start).toHaveBeenCalledTimes(1);
    // pg-boss refuses to run SQL before start, so order matters.
    expect(boss.start.mock.invocationCallOrder[0]).toBeLessThan(
      boss.send.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("opens the connection before reading metrics", async () => {
    const boss = fakeBoss();

    await queueWith(boss, "test.one").metrics();

    expect(boss.start).toHaveBeenCalledTimes(1);
  });

  it("starts once across many concurrent enqueues", async () => {
    const boss = fakeBoss();
    const queue = queueWith(boss, "test.one");

    await Promise.all(
      ["a", "b", "c", "d"].map((key) =>
        queue.send("test.one", {
          organizationId: "org_a",
          key,
          payload: { id: key },
        }),
      ),
    );

    expect(boss.start).toHaveBeenCalledTimes(1);
    expect(boss.createQueue).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledTimes(4);
  });

  it("scopes the pg-boss singleton key to the organization", async () => {
    const boss = fakeBoss();

    await queueWith(boss, "test.one").send("test.one", {
      organizationId: "org_a",
      key: "k1",
      payload: { id: "1" },
    });

    expect(boss.send).toHaveBeenCalledWith(
      "test.one",
      expect.objectContaining({ organizationId: "org_a", key: "k1" }),
      { singletonKey: "org_a:k1" },
    );
  });

  it("refuses an unregistered job type without touching the queue", async () => {
    const boss = fakeBoss();

    await expect(
      queueWith(boss, "test.one").send("test.missing", {
        organizationId: "org_a",
        key: "k1",
        payload: { id: "1" },
      }),
    ).rejects.toThrow(/not registered/);
    expect(boss.send).not.toHaveBeenCalled();
  });
});

describe("PgBossJobQueue metrics", () => {
  it("reports the runnable backlog, not the deferred total", async () => {
    const boss = fakeBoss();

    await expect(queueWith(boss, "test.one").metrics()).resolves.toEqual([
      { name: "test.one", depth: 4, active: 2, failed: 1 },
    ]);
  });

  it("reports zeroes for a queue pg-boss does not know yet", async () => {
    const boss = fakeBoss();
    boss.getQueue.mockResolvedValue(null);

    await expect(queueWith(boss, "test.one").metrics()).resolves.toEqual([
      { name: "test.one", depth: 0, active: 0, failed: 0 },
    ]);
  });
});
