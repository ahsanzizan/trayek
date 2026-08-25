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

  it("records zero-cost Baileys attribution metadata before sending", async () => {
    let createdData: unknown;
    const messageLog: BaileysMessageLogStore = {
      async create({ data }) {
        createdData = data;
        return { id: "log-1" };
      },
      async update() {
        return undefined;
      },
    };
    const adapter = createBaileysAdapter({
      organizationId: "org-a",
      socket: {
        async sendMessage() {
          return { key: { id: "wa-message-1" } };
        },
      },
      messageLog,
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
    });

    await adapter.sendMessage("+6281234567890", "hello");

    expect(createdData).toEqual(
      expect.objectContaining({
        category: "WHATSAPP_BAILEYS",
        estimatedCost: 0,
        conversationWindowState: "N/A",
      }),
    );
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
        instruction:
          "Pesan WhatsApp gagal terkirim — coba lagi manual dari console",
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

  it("extracts button, list, and template reply selections", () => {
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

    expect(
      adapter.parseInbound({
        type: "notify",
        messages: [
          {
            key: {
              id: "btn-1",
              remoteJid: "6281234567890@s.whatsapp.net",
              fromMe: false,
            },
            message: { buttonsResponseMessage: { selectedButtonId: "YA" } },
            messageTimestamp: 1_756_080_000,
          },
        ],
      }).body,
    ).toBe("YA");

    expect(
      adapter.parseInbound({
        type: "notify",
        messages: [
          {
            key: {
              id: "list-1",
              remoteJid: "6281234567890@s.whatsapp.net",
              fromMe: false,
            },
            message: {
              listResponseMessage: {
                singleSelectReply: { selectedRowId: "row-2" },
              },
            },
            messageTimestamp: 1_756_080_000,
          },
        ],
      }).body,
    ).toBe("row-2");
  });

  it("parses every message in an upsert batch, skipping invalid ones", () => {
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

    const batch = adapter.parseInboundBatch?.({
      type: "notify",
      messages: [
        {
          key: {
            id: "batch-1",
            remoteJid: "6281234567890@s.whatsapp.net",
            fromMe: false,
          },
          message: { conversation: "satu" },
          messageTimestamp: 1_756_080_000,
        },
        {
          key: { id: "batch-2", remoteJid: "6281234567890@s.whatsapp.net" },
          message: { conversation: "dua" },
          messageTimestamp: 1_756_080_001,
        },
        {
          key: {
            id: "batch-3",
            remoteJid: "6281234567890@s.whatsapp.net",
            fromMe: true,
          },
          message: { conversation: "echo" },
          messageTimestamp: 1_756_080_002,
        },
      ],
    });

    expect(batch).toHaveLength(2);
    expect(batch?.map((m) => m.body)).toEqual(["satu", "dua"]);
  });

  it("marks a LID jid with a lid: prefix instead of a fake E.164", () => {
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
            id: "lid-1",
            remoteJid: "123456789012345678@lid",
            fromMe: false,
          },
          message: { conversation: "dari lid" },
          messageTimestamp: 1_756_080_000,
        },
      ],
    });

    expect(inbound.from).toBe("lid:123456789012345678");
  });

  it("rethrows the original send error even when fallback notification fails", async () => {
    const operations: string[] = [];
    const socket: BaileysSocket = {
      async sendMessage() {
        throw new Error("socket unavailable");
      },
    };
    const adapter = createBaileysAdapter({
      organizationId: "org-a",
      socket,
      messageLog: createMessageLogStore(operations),
      notifyHumanFallback: vi.fn().mockRejectedValue(new Error("store down")),
      reporter: { reportError: vi.fn() },
    });

    await expect(
      adapter.sendMessage("+6281234567890", "hello"),
    ).rejects.toThrow("socket unavailable");
  });
});
