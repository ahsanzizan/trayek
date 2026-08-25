import { pathToFileURL } from "node:url";

import {
  Browsers,
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
import { costMetadataFor } from "~/server/domain/channel/cost";
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
import { truncateBody } from "~/server/channels/message-log";
import { channelQrBroker } from "~/server/channels/qr-broker";
import { resolveBaileysConfig } from "~/server/channels/config";
import { isRecord } from "~/lib/guards";
import { toJid } from "~/server/channels/whatsapp/jid";

type WorkerEventName = "creds.update" | "connection.update" | "messages.upsert";

type WorkerEventHandler = (payload: unknown) => void | Promise<void>;

export interface BaileysWorkerSocket extends BaileysSocket {
  ev: {
    on(event: WorkerEventName, handler: WorkerEventHandler): unknown;
  };
  end(error?: Error): Promise<void>;
  requestPairingCode(phoneNumber: string): Promise<string>;
  /** True once `end()` has resolved; the socket is no longer usable. */
  ended: boolean;
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

const HARD_MAX_CHANNEL_SOCKETS = 50;

const CONNECTED_SOCKET_REFRESH_MS = 5_000;

const PAIRING_SCAN_INTERVAL_MS = 30_000;

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
  maxReconnectDelayMs?: number;
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
  /** Set when `connection.update` reports `open`; cleared on close. */
  isOpen: boolean;
}

interface ConnectionUpdate {
  connection?: string;
  qr?: string;
  lastDisconnect?: unknown;
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

  if (isRecord(output) && typeof output.statusCode === "number") {
    return output.statusCode;
  }

  if (typeof value.error.statusCode === "number") {
    return value.error.statusCode;
  }

  if (
    typeof value.error.code === "string" &&
    value.error.code in DisconnectReason
  ) {
    return DisconnectReason[value.error.code as keyof typeof DisconnectReason];
  }

  return undefined;
}

function isLoggedOut(reason: number | undefined): boolean {
  return reason === DisconnectReason.loggedOut;
}

function isConnectionReplaced(reason: number | undefined): boolean {
  return reason === DisconnectReason.connectionReplaced;
}

/** Reasons where retrying is pointless and the session must be re-paired. */
function isTerminal(reason: number | undefined): reason is DisconnectReason {
  return (
    reason === DisconnectReason.badSession ||
    reason === DisconnectReason.forbidden ||
    reason === DisconnectReason.multideviceMismatch
  );
}

/** Reasons that require an immediate socket restart without backoff. */
function isRestartRequired(reason: number | undefined): boolean {
  return reason === DisconnectReason.restartRequired;
}

function retryDelay(
  policy: BaileysWorkerRetryPolicy,
  attempt: number,
  random: () => number,
  maxDelayMs: number,
): number {
  const base = Math.min(
    maxDelayMs,
    policy.initialDelayMs * policy.factor ** Math.max(0, attempt - 1),
  );
  const jitter = base * policy.jitter * (random() * 2 - 1);

  return Math.max(0, Math.round(base + jitter));
}

function touchLru<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
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
  maxReconnectDelayMs = retryPolicy.maxDelayMs,
}: BaileysChannelWorkerOptions): BaileysChannelWorker {
  if (
    !Number.isInteger(maxChannelSockets) ||
    maxChannelSockets < 1 ||
    maxChannelSockets > HARD_MAX_CHANNEL_SOCKETS
  ) {
    throw new RangeError(
      `maxChannelSockets must be an integer between 1 and ${HARD_MAX_CHANNEL_SOCKETS}`,
    );
  }

  const entries = new Map<string, WorkerEntry>();
  const retryAttempts = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const publishQr =
    onQr ?? ((event: BaileysQrEvent) => channelQrBroker.publish(event));
  let connectionQueue = Promise.resolve();

  const heartbeatInterval = setInterval(() => {
    for (const orgId of entries.keys()) {
      const entry = entries.get(orgId);

      if (!entry) {
        continue;
      }

      if (entry.socket.ended || !entry.isOpen) {
        continue;
      }

      void updateStatus(orgId, "CONNECTED", now()).catch((error: unknown) => {
        reporter.reportError(error, "Baileys heartbeat status update failed", {
          organizationId: orgId,
        });
      });
    }
  }, CONNECTED_SOCKET_REFRESH_MS);

  // Lazy pairing: an organization whose row was just created on the web
  // surface (no socket yet) must be picked up without a worker restart.
  const pairingScanInterval = setInterval(() => {
    void (async () => {
      const orgIds = repository.listOrganizationIds
        ? await repository.listOrganizationIds()
        : [];

      for (const orgId of orgIds) {
        if (entries.has(orgId)) {
          continue;
        }

        void connect(orgId).catch((error: unknown) => {
          reporter.reportError(error, "Baileys pairing scan connect failed", {
            organizationId: orgId,
          });
        });
      }
    })().catch((error: unknown) => {
      reporter.reportError(error, "Baileys pairing scan failed");
    });
  }, PAIRING_SCAN_INTERVAL_MS);

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
    options: { persist?: boolean } = { persist: true },
  ): Promise<void> {
    const entry = entries.get(organizationId);

    if (!entry) {
      await updateStatus(organizationId, status);
      return;
    }

    entries.delete(organizationId);

    try {
      await entry.socket.end(undefined);
    } finally {
      await entry.session.dispose(options);
      await updateStatus(organizationId, status);
    }
  }

  async function emitConnectionFallback(organizationId: string): Promise<void> {
    await notifyHumanFallback({
      organizationId,
      source: "baileys",
      dedupeKey: `${organizationId}:connection:terminal`,
      entityType: "ChannelConnection",
      entityId: organizationId,
      instruction:
        "Koneksi WhatsApp gagal dipulihkan — buka console dan lakukan pairing ulang secara manual",
      occurredAt: now(),
    });
  }

  async function scheduleReconnect(
    organizationId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    if (retryTimers.has(organizationId)) {
      return;
    }

    const attempt = (retryAttempts.get(organizationId) ?? 0) + 1;

    if (options.force) {
      retryAttempts.set(organizationId, attempt);
      await removeEntry(organizationId, "DISCONNECTED", { persist: false });
      void connect(organizationId).catch((error: unknown) => {
        reporter.reportError(error, "Baileys forced reconnect failed", {
          organizationId,
          attempt,
        });
      });
      return;
    }

    retryAttempts.set(organizationId, attempt);

    if (attempt > retryPolicy.maxAttempts) {
      try {
        await emitConnectionFallback(organizationId);
      } catch (error) {
        reporter.reportError(error, "Baileys reconnect fallback failed", {
          organizationId,
        });
      }
      return;
    }

    const delay = retryDelay(retryPolicy, attempt, random, maxReconnectDelayMs);
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

    entry.socket.ev.on("messages.upsert", (payload: unknown) => {
      const raw = payload as
        | {
            type?: string;
            messages?: Array<{
              key?: { fromMe?: boolean; remoteJid?: string };
            }>;
          }
        | undefined;
      const first = raw?.messages?.[0];
      logger.info("Baileys messages.upsert received", {
        type: raw?.type,
        fromMe: first?.key?.fromMe,
        hasRemoteJid: Boolean(first?.key?.remoteJid),
        count: raw?.messages?.length,
      });

      try {
        const messages =
          entry.adapter.parseInboundBatch?.(payload) ??
          (() => {
            const message = entry.adapter.parseInbound(payload);
            return message ? [message] : [];
          })();

        for (const message of messages) {
          const inboundTruncated = truncateBody(message.body);
          const dedupe = messageLog.findByExternalId?.({
            organizationId: entry.organizationId,
            externalId: message.id,
          });

          const persist = (dedupe ?? Promise.resolve(null)).then((existing) => {
            if (existing) {
              return;
            }

            const costMetadata = costMetadataFor("WHATSAPP_BAILEYS");
            return messageLog
              .create({
                data: {
                  organizationId: entry.organizationId,
                  channel: "WHATSAPP_BAILEYS",
                  direction: "INBOUND",
                  from: message.from,
                  to: message.to,
                  body: inboundTruncated.body,
                  status: "PENDING",
                  truncated: inboundTruncated.truncated,
                  ...costMetadata,
                },
              })
              .then((log) =>
                messageLog.update({
                  where: { id: log.id },
                  data: { status: "SENT", externalId: message.id },
                }),
              );
          });

          void persist.catch((error: unknown) => {
            reporter.reportError(
              error,
              "Baileys inbound message persistence failed",
              {
                organizationId: entry.organizationId,
              },
            );
          });
        }
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

    entry.socket.ev.on("connection.update", (payload) =>
      handleConnectionUpdate(entry, asConnectionUpdate(payload)).catch(
        (error: unknown) => {
          reporter.reportError(error, "Baileys connection update failed", {
            organizationId: entry.organizationId,
          });
        },
      ),
    );
  }

  async function handleQr(update: ConnectionUpdate, entry: WorkerEntry) {
    if (!update.qr) return;
    void repository
      .saveActiveQr?.(entry.organizationId, update.qr)
      .catch((error: unknown) => {
        reporter.reportError(error, "Failed to persist active QR to database", {
          organizationId: entry.organizationId,
        });
      });
    publishQr({
      organizationId: entry.organizationId,
      qr: update.qr,
      createdAt: now(),
    });
  }

  async function handleOpen(entry: WorkerEntry) {
    entry.isOpen = true;
    retryAttempts.delete(entry.organizationId);
    await updateStatus(entry.organizationId, "CONNECTED", now());
    await clearActiveQrIfAny(entry.organizationId);
  }

  async function clearActiveQrIfAny(organizationId: string): Promise<void> {
    try {
      const active = await repository.getActiveQr?.(organizationId);

      if (active) {
        await repository.clearActiveQr?.(organizationId, active.version);
        channelQrBroker.clear(organizationId);
      }
    } catch (error) {
      reporter.reportError(error, "Baileys active QR clear failed", {
        organizationId,
      });
    }
  }

  async function handleLoggedOut(entry: WorkerEntry) {
    try {
      await repository.clearAuthState?.(entry.organizationId);
    } catch (error) {
      reporter.reportError(error, "Baileys logout state clear failed", {
        organizationId: entry.organizationId,
      });
      throw error;
    }

    await removeEntry(entry.organizationId, "NEEDS_PAIRING", {
      persist: false,
    });
    await connect(entry.organizationId);
  }

  async function handleReplaced(entry: WorkerEntry) {
    logger.warn("Baileys connection replaced", {
      organizationId: entry.organizationId,
    });
    await removeEntry(entry.organizationId, "DISCONNECTED");
  }

  async function handleTerminal(entry: WorkerEntry, reason: DisconnectReason) {
    logger.warn("Baileys terminal disconnect, pairing required", {
      organizationId: entry.organizationId,
      reason,
    });

    if (reason === DisconnectReason.badSession) {
      try {
        await repository.clearAuthState?.(entry.organizationId);
      } catch (error) {
        reporter.reportError(error, "Baileys bad session clear failed", {
          organizationId: entry.organizationId,
        });
      }
    }

    await removeEntry(entry.organizationId, "NEEDS_PAIRING", {
      persist: false,
    });
    await connect(entry.organizationId);
  }

  async function handleConnectionUpdate(
    entry: WorkerEntry,
    update: ConnectionUpdate,
  ): Promise<void> {
    if (entries.get(entry.organizationId)?.socket !== entry.socket) return;

    await handleQr(update, entry);

    if (update.connection === "open") return handleOpen(entry);
    if (update.connection !== "close") return;

    entry.isOpen = false;

    const reason = disconnectReason(update.lastDisconnect);

    if (isLoggedOut(reason)) return handleLoggedOut(entry);
    if (isConnectionReplaced(reason)) return handleReplaced(entry);
    if (isTerminal(reason)) return handleTerminal(entry, reason);
    if (isRestartRequired(reason))
      return scheduleReconnect(entry.organizationId, { force: true });

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
    const existing = touchLru(entries, organizationId);

    if (existing) {
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
        isOpen: false,
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

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const next = connectionQueue.then(operation);
    connectionQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    connect,

    disconnect(organizationId) {
      const timer = retryTimers.get(organizationId);

      if (timer) {
        clearTimeout(timer);
        retryTimers.delete(organizationId);
      }

      retryAttempts.delete(organizationId);
      return enqueue(() => removeEntry(organizationId, "DISCONNECTED"));
    },

    getSocket(organizationId) {
      return touchLru(entries, organizationId)?.socket ?? null;
    },

    getAdapter(organizationId) {
      return touchLru(entries, organizationId)?.adapter ?? null;
    },

    async requestPairingCode(organizationId, phone) {
      const jid = toJid(phone);
      const socket = await connect(organizationId);
      return socket.requestPairingCode(jid.replace("@s.whatsapp.net", ""));
    },

    async close() {
      clearInterval(heartbeatInterval);
      clearInterval(pairingScanInterval);

      for (const timer of retryTimers.values()) {
        clearTimeout(timer);
      }
      retryTimers.clear();
      retryAttempts.clear();

      const organizationIds = [...entries.keys()];
      await Promise.allSettled(
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
  return (state) => {
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });

    const wrapped = socket as unknown as BaileysWorkerSocket;
    wrapped.ended = false;

    const originalEnd = socket.end.bind(socket);
    socket.end = async (error?: Error) => {
      await originalEnd(error);
      wrapped.ended = true;
    };

    return wrapped;
  };
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

  const targetOrgIds = repository.listOrganizationIds
    ? await repository.listOrganizationIds()
    : (
        await database.channelConnection.findMany({
          where: {
            channel: "WHATSAPP_BAILEYS",
            status: { not: "DISCONNECTED" },
          },
          select: { organizationId: true },
        })
      ).map((c) => c.organizationId);

  // Startup connects only organizations with a persisted channel connection;
  // new organizations are connected lazily when the pairing surface first
  // requests them, avoiding a thundering herd of sockets at boot.
  for (const orgId of targetOrgIds) {
    void worker.connect(orgId).catch((error: unknown) => {
      defaultReporter.reportError(
        error,
        "Failed to connect organization on startup",
        {
          organizationId: orgId,
        },
      );
    });
  }

  return worker;
}

async function main(): Promise<void> {
  const worker = await startChannelWorker();
  defaultLogger.info("Baileys channel worker running");

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      defaultLogger.info("Stopping Baileys channel worker...");
      process.off("SIGTERM", onSigTerm);
      process.off("SIGINT", onSigInt);
      await worker.close();
      resolve();
    };

    const onSigTerm = () => void shutdown();
    const onSigInt = () => void shutdown();

    process.on("SIGTERM", onSigTerm);
    process.on("SIGINT", onSigInt);
  });

  process.exit(0);
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  void main();
}
