import { pathToFileURL } from "node:url";

import {
  DisconnectReason,
  makeWASocket,
  type AuthenticationState,
} from "@whiskeysockets/baileys";

import { env } from "~/env";
import {
  createPrismaBaileysMessageLogStore,
  createBaileysAdapter,
  type BaileysAdapterOptions,
  type BaileysMessageLogStore,
  type BaileysSocket,
} from "~/server/channels/whatsapp/baileys-adapter";
import {
  createBaileysSession,
  createPrismaBaileysChannelRepository,
  type BaileysChannelRepository,
  type BaileysSession,
  type ChannelConnectionStatus,
} from "~/server/channels/whatsapp/session-store";
import { type ChannelAdapter } from "~/server/domain/ports/channel";
import { type HumanFallbackRequired } from "~/server/domain/jobs/port";
import { PrismaJobStore } from "~/server/jobs/prisma-job-store";
import {
  reporter as defaultReporter,
  type Reporter,
} from "~/server/observability/reporter";
import {
  logger as defaultLogger,
  type ObservabilityLogger,
} from "~/server/observability/logger";
import { db } from "~/server/db";
import { normalizeIndonesianPhone } from "~/server/domain/driver/phone";
import { MAX_MESSAGE_BODY_LENGTH } from "~/server/channels/message-log";
import { channelQrBroker } from "~/server/channels/qr-broker";
import { resolveBaileysConfig } from "~/server/channels/config";

type WorkerEventName = "creds.update" | "connection.update" | "messages.upsert";

type WorkerEventHandler = (payload: unknown) => void | Promise<void>;

export interface BaileysWorkerSocket extends BaileysSocket {
  ev: {
    on(event: WorkerEventName, handler: WorkerEventHandler): unknown;
  };
  end(error?: Error): Promise<void>;
  requestPairingCode(phoneNumber: string): Promise<string>;
}

export interface BaileysQrEvent {
  organizationId: string;
  qr: string;
  createdAt: Date;
}

export interface BaileysWorkerRetryPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: number;
  maxAttempts: number;
}

const DEFAULT_RETRY_POLICY: BaileysWorkerRetryPolicy = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: 0.2,
  maxAttempts: 5,
};

export interface BaileysChannelWorkerOptions {
  repository: BaileysChannelRepository;
  messageLog: BaileysMessageLogStore;
  notifyHumanFallback: (event: HumanFallbackRequired) => Promise<void>;
  socketFactory: (
    state: AuthenticationState,
  ) => BaileysWorkerSocket | Promise<BaileysWorkerSocket>;
  maxChannelSockets: number;
  authDirectory?: string;
  reporter?: Reporter;
  logger?: ObservabilityLogger;
  retryPolicy?: BaileysWorkerRetryPolicy;
  onQr?: (event: BaileysQrEvent) => void;
  now?: () => Date;
  random?: () => number;
}

export interface BaileysChannelWorker {
  connect(organizationId: string): Promise<BaileysWorkerSocket>;
  disconnect(organizationId: string): Promise<void>;
  getSocket(organizationId: string): BaileysWorkerSocket | null;
  getAdapter(organizationId: string): ChannelAdapter | null;
  requestPairingCode(organizationId: string, phone: string): Promise<string>;
  close(): Promise<void>;
}

interface WorkerEntry {
  organizationId: string;
  socket: BaileysWorkerSocket;
  session: BaileysSession;
  adapter: ChannelAdapter;
}

interface ConnectionUpdate {
  connection?: string;
  qr?: string;
  lastDisconnect?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asConnectionUpdate(value: unknown): ConnectionUpdate {
  if (!isRecord(value)) {
    return {};
  }

  return {
    connection:
      typeof value.connection === "string" ? value.connection : undefined,
    qr: typeof value.qr === "string" ? value.qr : undefined,
    lastDisconnect: value.lastDisconnect,
  };
}

function disconnectReason(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }

  const output = value.error.output;

  if (!isRecord(output) || typeof output.statusCode !== "number") {
    return undefined;
  }

  return output.statusCode;
}

function retryDelay(
  policy: BaileysWorkerRetryPolicy,
  attempt: number,
  random: () => number,
): number {
  const base = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * policy.factor ** Math.max(0, attempt - 1),
  );
  const jitter = base * policy.jitter * (random() * 2 - 1);

  return Math.max(0, Math.round(base + jitter));
}

export function createBaileysChannelWorker({
  repository,
  messageLog,
  notifyHumanFallback,
  socketFactory,
  maxChannelSockets,
  authDirectory,
  reporter = defaultReporter,
  logger = defaultLogger,
  retryPolicy = DEFAULT_RETRY_POLICY,
  onQr,
  now = () => new Date(),
  random = Math.random,
}: BaileysChannelWorkerOptions): BaileysChannelWorker {
  if (!Number.isInteger(maxChannelSockets) || maxChannelSockets < 1) {
    throw new RangeError("maxChannelSockets must be a positive integer");
  }

  const entries = new Map<string, WorkerEntry>();
  const retryAttempts = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const publishQr =
    onQr ?? ((event: BaileysQrEvent) => channelQrBroker.publish(event));
  let connectionQueue = Promise.resolve();

  async function updateStatus(
    organizationId: string,
    status: ChannelConnectionStatus,
    connectedAt?: Date,
  ): Promise<void> {
    try {
      await repository.updateChannelStatus(organizationId, status, connectedAt);
    } catch (error) {
      reporter.reportError(error, "Baileys connection status update failed", {
        organizationId,
        status,
      });
      throw error;
    }
  }

  async function removeEntry(
    organizationId: string,
    status: ChannelConnectionStatus,
  ): Promise<void> {
    const entry = entries.get(organizationId);

    if (!entry) {
      return;
    }

    entries.delete(organizationId);

    try {
      await entry.socket.end(undefined);
    } finally {
      await entry.session.dispose();
      await updateStatus(organizationId, status);
    }
  }

  async function emitConnectionFallback(
    organizationId: string,
    attempt: number,
  ): Promise<void> {
    await notifyHumanFallback({
      organizationId,
      source: "baileys",
      dedupeKey: `${organizationId}:connection:${attempt}`,
      entityType: "ChannelConnection",
      entityId: organizationId,
      instruction:
        "Koneksi WhatsApp gagal dipulihkan — buka console dan lakukan pairing ulang secara manual",
      occurredAt: now(),
    });
  }

  async function scheduleReconnect(organizationId: string): Promise<void> {
    if (retryTimers.has(organizationId)) {
      return;
    }

    const attempt = (retryAttempts.get(organizationId) ?? 0) + 1;
    retryAttempts.set(organizationId, attempt);

    if (attempt > retryPolicy.maxAttempts) {
      retryAttempts.delete(organizationId);
      try {
        await emitConnectionFallback(organizationId, attempt);
      } catch (error) {
        reporter.reportError(error, "Baileys reconnect fallback failed", {
          organizationId,
        });
      }
      return;
    }

    const delay = retryDelay(retryPolicy, attempt, random);
    const timer = setTimeout(() => {
      retryTimers.delete(organizationId);
      void connect(organizationId).catch((error: unknown) => {
        reporter.reportError(error, "Baileys reconnect failed", {
          organizationId,
          attempt,
        });
        void scheduleReconnect(organizationId);
      });
    }, delay);

    retryTimers.set(organizationId, timer);
  }

  function attachListeners(entry: WorkerEntry): void {
    entry.socket.ev.on("creds.update", () =>
      entry.session.saveCreds().catch((error: unknown) => {
        reporter.reportError(error, "Baileys auth state persistence failed", {
          organizationId: entry.organizationId,
        });
      }),
    );

    entry.socket.ev.on("messages.upsert", (payload) => {
      try {
        const message = entry.adapter.parseInbound(payload);
        void messageLog
          .create({
            data: {
              organizationId: entry.organizationId,
              channel: "WHATSAPP_BAILEYS",
              direction: "INBOUND",
              from: message.from,
              to: message.to,
              body: message.body.slice(0, MAX_MESSAGE_BODY_LENGTH),
              status: "PENDING",
              truncated: message.body.length > MAX_MESSAGE_BODY_LENGTH,
            },
          })
          .then((log) =>
            messageLog.update({
              where: { id: log.id },
              data: { status: "SENT", externalId: message.id },
            }),
          )
          .catch((error: unknown) => {
            reporter.reportError(
              error,
              "Baileys inbound message persistence failed",
              {
                organizationId: entry.organizationId,
              },
            );
          });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "IGNORED_MESSAGE_UPSERT"
        ) {
          return;
        }

        reporter.reportError(error, "Baileys inbound message parsing failed", {
          organizationId: entry.organizationId,
        });
      }
    });

    entry.socket.ev.on("connection.update", (payload) => {
      void handleConnectionUpdate(entry, asConnectionUpdate(payload)).catch(
        (error: unknown) => {
          reporter.reportError(error, "Baileys connection update failed", {
            organizationId: entry.organizationId,
          });
        },
      );
    });
  }

  async function handleConnectionUpdate(
    entry: WorkerEntry,
    update: ConnectionUpdate,
  ): Promise<void> {
    if (entries.get(entry.organizationId)?.socket !== entry.socket) {
      return;
    }

    if (update.qr) {
      publishQr({
        organizationId: entry.organizationId,
        qr: update.qr,
        createdAt: now(),
      });
    }

    if (update.connection === "open") {
      retryAttempts.delete(entry.organizationId);
      await updateStatus(entry.organizationId, "CONNECTED", now());
      return;
    }

    if (update.connection !== "close") {
      return;
    }

    const reason = disconnectReason(update.lastDisconnect);

    if (reason === DisconnectReason.loggedOut) {
      await updateStatus(entry.organizationId, "NEEDS_PAIRING");
      await removeEntry(entry.organizationId, "NEEDS_PAIRING");
      return;
    }

    if (reason === DisconnectReason.connectionReplaced) {
      logger.warn("Baileys connection replaced", {
        organizationId: entry.organizationId,
      });
      await removeEntry(entry.organizationId, "DISCONNECTED");
      return;
    }

    await updateStatus(entry.organizationId, "DISCONNECTED");
    await removeEntry(entry.organizationId, "DISCONNECTED");
    await scheduleReconnect(entry.organizationId);
  }

  async function evictOldest(): Promise<void> {
    const oldest = entries.values().next().value;

    if (oldest) {
      await removeEntry(oldest.organizationId, "DISCONNECTED");
    }
  }

  async function connectInternal(
    organizationId: string,
  ): Promise<BaileysWorkerSocket> {
    const existing = entries.get(organizationId);

    if (existing) {
      entries.delete(organizationId);
      entries.set(organizationId, existing);
      return existing.socket;
    }

    while (entries.size >= maxChannelSockets) {
      await evictOldest();
    }

    const session = await createBaileysSession({
      organizationId,
      repository,
      authDirectory,
    });

    try {
      const socket = await socketFactory(session.state);
      const adapterOptions: BaileysAdapterOptions = {
        organizationId,
        socket,
        messageLog,
        notifyHumanFallback,
        reporter,
        now,
      };
      const entry: WorkerEntry = {
        organizationId,
        socket,
        session,
        adapter: createBaileysAdapter(adapterOptions),
      };

      entries.set(organizationId, entry);
      attachListeners(entry);
      return socket;
    } catch (error) {
      await session.dispose();
      throw error;
    }
  }

  function connect(organizationId: string): Promise<BaileysWorkerSocket> {
    const next = connectionQueue.then(() => connectInternal(organizationId));
    connectionQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    connect,

    async disconnect(organizationId) {
      const timer = retryTimers.get(organizationId);

      if (timer) {
        clearTimeout(timer);
        retryTimers.delete(organizationId);
      }

      retryAttempts.delete(organizationId);
      await removeEntry(organizationId, "DISCONNECTED");
    },

    getSocket(organizationId) {
      const entry = entries.get(organizationId);

      if (!entry) {
        return null;
      }

      entries.delete(organizationId);
      entries.set(organizationId, entry);
      return entry.socket;
    },

    getAdapter(organizationId) {
      const entry = entries.get(organizationId);

      if (!entry) {
        return null;
      }

      entries.delete(organizationId);
      entries.set(organizationId, entry);
      return entry.adapter;
    },

    async requestPairingCode(organizationId, phone) {
      const normalized = normalizeIndonesianPhone(phone);

      if (!normalized.ok) {
        throw new Error("INVALID_E164");
      }

      const socket = await connect(organizationId);
      return socket.requestPairingCode(normalized.e164.slice(1));
    },

    async close() {
      for (const timer of retryTimers.values()) {
        clearTimeout(timer);
      }
      retryTimers.clear();
      retryAttempts.clear();

      const organizationIds = [...entries.keys()];
      await Promise.all(
        organizationIds.map((organizationId) =>
          removeEntry(organizationId, "DISCONNECTED"),
        ),
      );
    },
  };
}

export function createDefaultBaileysSocketFactory(): (
  state: AuthenticationState,
) => BaileysWorkerSocket {
  return (state) => makeWASocket({ auth: state, printQRInTerminal: false });
}

export async function startChannelWorker(): Promise<BaileysChannelWorker> {
  const database = db;
  const repository = createPrismaBaileysChannelRepository(database);
  const fallbackStore = new PrismaJobStore(database);
  const config = resolveBaileysConfig({
    nodeEnv: env.NODE_ENV,
    authDir: env.BAILEYS_AUTH_DIR,
    maxChannelSockets: env.MAX_CHANNEL_SOCKETS,
  });
  const worker = createBaileysChannelWorker({
    repository,
    messageLog: createPrismaBaileysMessageLogStore(database),
    notifyHumanFallback: async (event) => {
      await fallbackStore.recordHumanFallback(event);
    },
    socketFactory: createDefaultBaileysSocketFactory(),
    maxChannelSockets: config.maxChannelSockets,
    authDirectory: config.authDir,
  });
  const connections = await database.channelConnection.findMany({
    where: { channel: "WHATSAPP_BAILEYS", status: "CONNECTED" },
    select: { organizationId: true },
  });

  await Promise.all(
    connections.map(({ organizationId }) => worker.connect(organizationId)),
  );

  return worker;
}

async function main(): Promise<void> {
  const worker = await startChannelWorker();
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  void main();
}
