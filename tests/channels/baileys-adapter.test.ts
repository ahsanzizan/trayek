import { describe, expect, it, vi } from "vitest";

import {
  createBaileysAdapter,
  type BaileysMessageLogStore,
  type BaileysSocket,
} from "~/server/channels/whatsapp/baileys-adapter";

function createMessageLogStore(operations: string[]): BaileysMessageLogStore {
  return {
    async create({ data }) {
      operations.push(`create:${data.status}`);
      return { id: "log-1" };
    },
    async update({ where, data }) {
      operations.push(`update:${where.id}:${data.status}`);
    },
  };
}

describe("Baileys channel adapter", () => {
  it("logs before sending and records the external message id", async () => {
    const operations: string[] = [];
    const socket: BaileysSocket = {
      async sendMessage(jid, content) {
        operations.push(`send:${jid}:${content.text}`);
        return { key: { id: "wa-message-1" } };
      },
    };
    const adapter = createBaileysAdapter({
      organizationId: "org-a",
      socket,
      messageLog: createMessageLogStore(operations),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      adapter.sendMessage("+6281234567890", "hello"),
    ).resolves.toEqual({ messageId: "wa-message-1" });
    expect(operations).toEqual([
      "create:PENDING",
      "send:6281234567890@s.whatsapp.net:hello",
      "update:log-1:SENT",
    ]);
  });

  it("marks a failed send and emits one human fallback", async () => {
    const operations: string[] = [];
    const notifyHumanFallback = vi.fn().mockResolvedValue(undefined);
    const reporter = { reportError: vi.fn() };
    const socket: BaileysSocket = {
      async sendMessage() {
        throw new Error("socket unavailable");
      },
    };
    const adapter = createBaileysAdapter({
      organizationId: "org-a",
      socket,
      messageLog: createMessageLogStore(operations),
      notifyHumanFallback,
      reporter,
    });

    await expect(
      adapter.sendMessage("+6281234567890", "hello"),
    ).rejects.toThrow("socket unavailable");
    expect(operations).toEqual(["create:PENDING", "update:log-1:FAILED"]);
    expect(notifyHumanFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        source: "baileys",
        entityId: "log-1",
        instruction: expect.stringContaining("manual"),
      }),
    );
    expect(reporter.reportError).toHaveBeenCalled();
  });

  it("parses notify messages and extracts text from supported message shapes", () => {
    const adapter = createBaileysAdapter({
      organizationId: "org-a",
      socket: {
        async sendMessage() {
          return { key: { id: "unused" } };
        },
      },
      messageLog: createMessageLogStore([]),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
    });

    const inbound = adapter.parseInbound({
      type: "notify",
      messages: [
        {
          key: {
            id: "inbound-1",
            remoteJid: "6281234567890@s.whatsapp.net",
            fromMe: false,
          },
          message: {
            extendedTextMessage: { text: "hello from WhatsApp" },
          },
          messageTimestamp: 1_756_080_000,
        },
      ],
    });

    expect(inbound).toMatchObject({
      id: "inbound-1",
      channel: "WHATSAPP_BAILEYS",
      from: "+6281234567890",
      to: "system",
      body: "hello from WhatsApp",
      timestamp: new Date(1_756_080_000 * 1000),
    });
  });

  it("rejects history sync and messages sent by the connected account", () => {
    const adapter = createBaileysAdapter({
      organizationId: "org-a",
      socket: {
        async sendMessage() {
          return { key: { id: "unused" } };
        },
      },
      messageLog: createMessageLogStore([]),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
    });

    expect(() =>
      adapter.parseInbound({ type: "append", messages: [] }),
    ).toThrow("IGNORED_MESSAGE_UPSERT");
    expect(() =>
      adapter.parseInbound({
        type: "notify",
        messages: [
          {
            key: {
              id: "outbound-1",
              remoteJid: "6281234567890@s.whatsapp.net",
              fromMe: true,
            },
            message: { conversation: "echo" },
          },
        ],
      }),
    ).toThrow("IGNORED_MESSAGE_UPSERT");
  });
});
