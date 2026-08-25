import { describe, expect, it } from "vitest";

import { type ChannelAdapter } from "~/server/domain/ports/channel";
import { createChannelRegistry } from "~/server/channels/registry";
import { createNoopAdapter } from "~/server/channels/noop-adapter";

function makeAdapter(): ChannelAdapter {
  return {
    async sendMessage() {
      return { messageId: "message-1" };
    },
    parseInbound(payload) {
      return payload as ReturnType<ChannelAdapter["parseInbound"]>;
    },
  };
}

describe("channel registry", () => {
  it("returns a registered adapter and refreshes its LRU position", () => {
    const adapterA = makeAdapter();
    const adapterB = makeAdapter();
    const adapterC = makeAdapter();
    const evicted: string[] = [];
    const registry = createChannelRegistry({
      maxEntries: 2,
      onEvict: ({ organizationId, channel }) => {
        evicted.push(`${organizationId}:${channel}`);
      },
    });

    registry.register("org-a", "EMAIL", adapterA);
    registry.register("org-b", "EMAIL", adapterB);
    expect(registry.get("org-a", "EMAIL")).toBe(adapterA);

    registry.register("org-c", "EMAIL", adapterC);

    expect(registry.get("org-a", "EMAIL")).toBe(adapterA);
    expect(registry.get("org-c", "EMAIL")).toBe(adapterC);
    expect(() => registry.get("org-b", "EMAIL")).toThrow(
      "CHANNEL_NOT_REGISTERED",
    );
    expect(evicted).toEqual(["org-b:EMAIL"]);
  });

  it("clears all registered adapters without affecting a new registry", () => {
    const registry = createChannelRegistry({ maxEntries: 2 });
    registry.register("org-a", "EMAIL", makeAdapter());

    registry.clear();

    expect(() => registry.get("org-a", "EMAIL")).toThrow(
      "CHANNEL_NOT_REGISTERED",
    );
  });
});

describe("no-op channel adapter", () => {
  it("records PENDING before completing the send as SENT", async () => {
    const operations: string[] = [];
    const statuses: string[] = [];
    const adapter = createNoopAdapter({
      organizationId: "org-a",
      messageLog: {
        async create({ data }) {
          operations.push("create");
          statuses.push(data.status);
          expect(data.organizationId).toBe("org-a");
          expect(data.channel).toBe("EMAIL");
          return { id: "log-1" };
        },
        async update({ where, data }) {
          operations.push(`update:${where.id}`);
          statuses.push(data.status);
        },
      },
      channel: "EMAIL",
      idGenerator: () => "message-1",
    });

    await expect(
      adapter.sendMessage("+628123456789", "hello"),
    ).resolves.toEqual({ messageId: "message-1" });
    expect(operations).toEqual(["create", "update:log-1"]);
    expect(statuses).toEqual(["PENDING", "SENT"]);
  });

  it("parses a channel-neutral inbound message without vendor types", () => {
    const adapter = createNoopAdapter({
      organizationId: "org-a",
      messageLog: {
        async create() {
          return { id: "log-1" };
        },
        async update() {
          return undefined;
        },
      },
      channel: "EMAIL",
    });
    const message = {
      id: "inbound-1",
      channel: "EMAIL" as const,
      from: "sender@example.com",
      to: "ops@example.com",
      body: "hello",
      timestamp: new Date("2026-08-25T00:00:00.000Z"),
      raw: { source: "test" },
    };

    expect(adapter.parseInbound(message)).toEqual(message);
  });
});
