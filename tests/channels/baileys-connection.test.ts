import { describe, expect, it, vi } from "vitest";
import { DisconnectReason } from "@whiskeysockets/baileys";

import {
  createBaileysChannelWorker,
  type BaileysWorkerSocket,
} from "~/server/channels/worker";
import { type BaileysMessageLogStore } from "~/server/channels/whatsapp/baileys-adapter";
import {
  type BaileysChannelRepository,
  type AuthStateBundle,
} from "~/server/channels/whatsapp/session-store";

function createRepository(): BaileysChannelRepository & {
  statuses: Map<string, string>;
} {
  const bundles = new Map<string, AuthStateBundle>();
  const statuses = new Map<string, string>();

  return {
    statuses,
    async loadAuthState(organizationId) {
      return bundles.get(organizationId) ?? null;
    },
    async saveAuthState(organizationId, bundle) {
      bundles.set(organizationId, bundle);
    },
    async getChannelStatus(organizationId) {
      return (
        (statuses.get(organizationId) as
          "CONNECTED" | "DISCONNECTED" | "NEEDS_PAIRING" | undefined) ?? null
      );
    },
    async updateChannelStatus(organizationId, status) {
      statuses.set(organizationId, status);
    },
  };
}

function createMessageLog(): BaileysMessageLogStore {
  return {
    async create() {
      return { id: "log-1" };
    },
    async update() {
      return undefined;
    },
  };
}

function createSocket() {
  const handlers = new Map<
    string,
    (payload: unknown) => void | Promise<void>
  >();
  const socket: BaileysWorkerSocket & {
    ended: boolean;
    emit(event: string, payload: unknown): Promise<void>;
  } = {
    ended: false,
    ev: {
      on(event, handler) {
        handlers.set(event, handler);
      },
    },
    async sendMessage() {
      return { key: { id: "message-1" } };
    },
    async requestPairingCode() {
      return "PAIR-1234";
    },
    async end() {
      socket.ended = true;
    },
    async emit(event, payload) {
      await handlers.get(event)?.(payload);
    },
  };

  return socket;
}

describe("Baileys channel worker lifecycle", () => {
  it("keeps one isolated socket per organization and evicts the oldest", async () => {
    const repository = createRepository();
    const sockets = [createSocket(), createSocket()];
    const worker = createBaileysChannelWorker({
      repository,
      messageLog: createMessageLog(),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory: vi
        .fn()
        .mockResolvedValueOnce(sockets[0])
        .mockResolvedValueOnce(sockets[1]),
      maxChannelSockets: 1,
    });

    const first = await worker.connect("org-a");
    const second = await worker.connect("org-b");

    expect(first).toBe(sockets[0]);
    expect(second).toBe(sockets[1]);
    expect(sockets[0]?.ended).toBe(true);
    expect(worker.getSocket("org-a")).toBeNull();
    expect(worker.getSocket("org-b")).toBe(sockets[1]);
  });

  it("maps logged out connections to pairing and restarts pairing socket", async () => {
    const repository = createRepository();
    const socket1 = createSocket();
    const socket2 = createSocket();
    const socketFactory = vi
      .fn()
      .mockResolvedValueOnce(socket1)
      .mockResolvedValueOnce(socket2);
    const worker = createBaileysChannelWorker({
      repository,
      messageLog: createMessageLog(),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory,
      maxChannelSockets: 2,
    });

    await worker.connect("org-a");
    await socket1.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    await vi.waitFor(() => {
      expect(repository.statuses.get("org-a")).toBe("NEEDS_PAIRING");
      expect(socketFactory).toHaveBeenCalledTimes(2);
      expect(socket1.ended).toBe(true);
    });
  });

  it("pins the disconnect reason values used by the reconnect contract", () => {
    expect(DisconnectReason.loggedOut).toBe(401);
    expect(DisconnectReason.connectionClosed).toBe(428);
    expect(DisconnectReason.connectionReplaced).toBe(440);
    expect(DisconnectReason.badSession).toBe(500);
    expect(DisconnectReason.restartRequired).toBe(515);
    expect(DisconnectReason.forbidden).toBe(403);
  });

  it("maps a bad session to pairing without a reconnect attempt", async () => {
    const repository = createRepository();
    const socket1 = createSocket();
    const socket2 = createSocket();
    const socketFactory = vi
      .fn()
      .mockResolvedValueOnce(socket1)
      .mockResolvedValueOnce(socket2);
    const worker = createBaileysChannelWorker({
      repository,
      messageLog: createMessageLog(),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory,
      maxChannelSockets: 2,
    });

    await worker.connect("org-a");
    await socket1.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 500 } } },
    });

    await vi.waitFor(() => {
      expect(repository.statuses.get("org-a")).toBe("NEEDS_PAIRING");
      expect(socketFactory).toHaveBeenCalledTimes(2);
      expect(socket1.ended).toBe(true);
    });
  });

  it("reads plain error statusCode, not only Boom output", async () => {
    const repository = createRepository();
    const socket1 = createSocket();
    const socket2 = createSocket();
    const socketFactory = vi
      .fn()
      .mockResolvedValueOnce(socket1)
      .mockResolvedValueOnce(socket2);
    const worker = createBaileysChannelWorker({
      repository,
      messageLog: createMessageLog(),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory,
      maxChannelSockets: 2,
    });

    await worker.connect("org-a");
    await socket1.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { statusCode: 401 } },
    });

    await vi.waitFor(() => {
      expect(repository.statuses.get("org-a")).toBe("NEEDS_PAIRING");
    });
  });

  it("reconnects immediately on restartRequired without exponential backoff", async () => {
    const repository = createRepository();
    const socket1 = createSocket();
    const socket2 = createSocket();
    const socketFactory = vi
      .fn()
      .mockResolvedValueOnce(socket1)
      .mockResolvedValueOnce(socket2);
    const worker = createBaileysChannelWorker({
      repository,
      messageLog: createMessageLog(),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory,
      maxChannelSockets: 2,
    });

    await worker.connect("org-a");
    await socket1.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 515 } } },
    });

    await vi.waitFor(() => expect(socketFactory).toHaveBeenCalledTimes(2));
    expect(socket1.ended).toBe(true);
  });

  it("persists every message in a multi-message upsert", async () => {
    const repository = createRepository();
    const socket = createSocket();
    const writes: string[] = [];
    const attributions: Array<{
      category: string;
      estimatedCost: number;
      conversationWindowState: string;
    }> = [];
    const messageLog: BaileysMessageLogStore = {
      async create({ data }) {
        writes.push(data.body);
        attributions.push({
          category: data.category,
          estimatedCost: data.estimatedCost,
          conversationWindowState: data.conversationWindowState,
        });
        return { id: `log-${writes.length}` };
      },
      async update() {
        return undefined;
      },
    };
    const worker = createBaileysChannelWorker({
      repository,
      messageLog,
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory: () => socket,
      maxChannelSockets: 2,
    });

    await worker.connect("org-a");
    await socket.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            id: "multi-1",
            remoteJid: "628123456789@s.whatsapp.net",
            fromMe: false,
          },
          message: { conversation: "satu" },
          messageTimestamp: 1_700_000_000,
        },
        {
          key: {
            id: "multi-2",
            remoteJid: "628123456789@s.whatsapp.net",
            fromMe: false,
          },
          message: { conversation: "dua" },
          messageTimestamp: 1_700_000_001,
        },
      ],
    });

    await vi.waitFor(() => expect(writes).toEqual(["satu", "dua"]));
    expect(attributions).toEqual([
      {
        category: "WHATSAPP_BAILEYS",
        estimatedCost: 0,
        conversationWindowState: "N/A",
      },
      {
        category: "WHATSAPP_BAILEYS",
        estimatedCost: 0,
        conversationWindowState: "N/A",
      },
    ]);
  });

  it("skips an inbound message whose external id is already stored", async () => {
    const repository = createRepository();
    const socket = createSocket();
    const writes: string[] = [];
    const messageLog: BaileysMessageLogStore = {
      async create({ data }) {
        writes.push(data.body);
        return { id: `log-${writes.length}` };
      },
      async update() {
        return undefined;
      },
      async findByExternalId({ externalId }) {
        return externalId === "dup-1" ? { id: "existing" } : null;
      },
    };
    const worker = createBaileysChannelWorker({
      repository,
      messageLog,
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory: () => socket,
      maxChannelSockets: 2,
    });

    await worker.connect("org-a");
    await socket.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: {
            id: "dup-1",
            remoteJid: "628123456789@s.whatsapp.net",
            fromMe: false,
          },
          message: { conversation: "duplicate" },
          messageTimestamp: 1_700_000_000,
        },
        {
          key: {
            id: "new-1",
            remoteJid: "628123456789@s.whatsapp.net",
            fromMe: false,
          },
          message: { conversation: "baru" },
          messageTimestamp: 1_700_000_001,
        },
      ],
    });

    await vi.waitFor(() => expect(writes).toEqual(["baru"]));
  });

  it("keeps inbound message writes scoped to the socket organization", async () => {
    const repository = createRepository();
    const socketA = createSocket();
    const socketB = createSocket();
    const sockets = [socketA, socketB];
    const writes: Array<{
      organizationId: string;
      from: string;
      body: string;
    }> = [];
    const messageLog: BaileysMessageLogStore = {
      async create({ data }) {
        writes.push({
          organizationId: data.organizationId,
          from: data.from,
          body: data.body,
        });
        return { id: `log-${writes.length}` };
      },
      async update() {
        return undefined;
      },
    };
    const worker = createBaileysChannelWorker({
      repository,
      messageLog,
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory: vi
        .fn()
        .mockResolvedValueOnce(sockets[0])
        .mockResolvedValueOnce(sockets[1]),
      maxChannelSockets: 2,
    });

    await Promise.all([worker.connect("org-a"), worker.connect("org-b")]);

    await Promise.all([
      socketA.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: {
              id: "inbound-a",
              remoteJid: "628123456789@s.whatsapp.net",
              fromMe: false,
            },
            message: { conversation: "pesan A" },
            messageTimestamp: 1_700_000_000,
          },
        ],
      }),
      socketB.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: {
              id: "inbound-b",
              remoteJid: "628987654321@s.whatsapp.net",
              fromMe: false,
            },
            message: { conversation: "pesan B" },
            messageTimestamp: 1_700_000_001,
          },
        ],
      }),
    ]);

    await vi.waitFor(() => expect(writes).toHaveLength(2));

    expect(writes).toEqual(
      expect.arrayContaining([
        {
          organizationId: "org-a",
          from: "+628123456789",
          body: "pesan A",
        },
        {
          organizationId: "org-b",
          from: "+628987654321",
          body: "pesan B",
        },
      ]),
    );
  });

  it("passes raw digits to socket.requestPairingCode without the JID suffix", async () => {
    let requestedNumber = "";
    const socket = createSocket();
    socket.requestPairingCode = vi
      .fn()
      .mockImplementation(async (phone: string) => {
        requestedNumber = phone;
        return "12345678";
      });

    const repository = createRepository();
    const worker = createBaileysChannelWorker({
      repository,
      messageLog: createMessageLog(),
      notifyHumanFallback: vi.fn().mockResolvedValue(undefined),
      socketFactory: () => socket,
      maxChannelSockets: 2,
    });

    const code = await worker.requestPairingCode("org-a", "+62 812-3456-7890");

    expect(code).toBe("12345678");
    expect(requestedNumber).toBe("6281234567890");
    expect(requestedNumber).not.toContain("@s.whatsapp.net");
  });
});
