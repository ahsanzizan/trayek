import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  useMultiFileAuthState as loadMultiFileAuthState,
  type AuthenticationState,
  type SignalKeyStore,
} from "@whiskeysockets/baileys";

import { type Prisma, type PrismaClient } from "~/generated/prisma";
import {
  ACTIVE_QR_KEY,
  extractActiveQr,
  QR_TTL_MS,
  type QrPayload,
} from "~/server/channels/qr-broker";
import { reporter } from "~/server/observability/reporter";
import {
  channelConnectionStatusValues,
  type ChannelConnectionStatus,
} from "~/server/domain/ports/channel";
import { isRecord } from "~/lib/guards";

export { channelConnectionStatusValues, type ChannelConnectionStatus };
export { ACTIVE_QR_KEY };

export interface AuthStateBundle {
  files: Record<string, Prisma.JsonValue>;
}

interface AuthStateRow {
  authState: Prisma.JsonValue | null;
  authStateVersion: number;
}

function authStateRow(value: unknown): AuthStateRow {
  if (!isRecord(value) || typeof value.authStateVersion !== "number") {
    return { authState: null, authStateVersion: 0 };
  }

  const authState = isJsonValue(value.authState) ? value.authState : null;
  return { authState, authStateVersion: value.authStateVersion };
}

export interface BaileysSessionRepository {
  loadAuthState(organizationId: string): Promise<AuthStateBundle | null>;
  saveAuthState(organizationId: string, bundle: AuthStateBundle): Promise<void>;
  clearAuthState?(organizationId: string): Promise<void>;
}

export interface BaileysChannelRepository extends BaileysSessionRepository {
  getChannelStatus(
    organizationId: string,
  ): Promise<ChannelConnectionStatus | null>;
  updateChannelStatus(
    organizationId: string,
    status: ChannelConnectionStatus,
    lastConnectedAt?: Date,
  ): Promise<void>;
  saveActiveQr?(organizationId: string, qr: string): Promise<void>;
  getActiveQr?(organizationId: string): Promise<QrPayload | null>;
  clearActiveQr?(
    organizationId: string,
    expectedVersion: number,
  ): Promise<void>;
  listOrganizationIds?(): Promise<string[]>;
  ensureChannelConnection?(organizationId: string): Promise<void>;
}

export interface BaileysSession {
  state: AuthenticationState;
  saveCreds(): Promise<void>;
  dispose(options?: { persist?: boolean }): Promise<void>;
}

export interface CreateBaileysSessionOptions {
  organizationId: string;
  repository: BaileysSessionRepository;
  authDirectory?: string;
}

function isJsonValue(value: unknown): value is Prisma.JsonValue {
  if (value === null) {
    return true;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function isSafeAuthFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    fileName !== "." &&
    fileName !== ".." &&
    basename(fileName) === fileName &&
    !fileName.includes("\\")
  );
}

function parseAuthStateBundle(value: unknown): AuthStateBundle | null {
  if (!isRecord(value) || !isRecord(value.files)) {
    return null;
  }

  const files: Record<string, Prisma.JsonValue> = {};

  for (const [fileName, fileValue] of Object.entries(value.files)) {
    if (!isSafeAuthFileName(fileName) || !isJsonValue(fileValue)) {
      return null;
    }

    files[fileName] = fileValue;
  }

  return { files };
}

function toInputJsonValue(bundle: AuthStateBundle): Prisma.InputJsonValue {
  return bundle as unknown as Prisma.InputJsonValue;
}

async function restoreAuthState(
  directory: string,
  bundle: AuthStateBundle | null,
): Promise<void> {
  if (!bundle) {
    return;
  }

  for (const [fileName, value] of Object.entries(bundle.files)) {
    await writeFile(join(directory, fileName), JSON.stringify(value));
  }
}

async function readAuthState(directory: string): Promise<AuthStateBundle> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Record<string, Prisma.JsonValue> = {};

  for (const entry of entries) {
    if (!entry.isFile() || !isSafeAuthFileName(entry.name)) {
      continue;
    }

    try {
      const value: unknown = JSON.parse(
        await readFile(join(directory, entry.name), "utf8"),
      );

      if (!isJsonValue(value)) {
        throw new Error("INVALID_BAILEYS_AUTH_STATE");
      }

      files[entry.name] = value;
    } catch (error) {
      throw new Error(`INVALID_BAILEYS_AUTH_STATE:${entry.name}`, {
        cause: error,
      });
    }
  }

  return { files };
}

function wrapKeyStore(
  keys: SignalKeyStore,
  persist: () => Promise<void>,
): SignalKeyStore {
  const wrapped: SignalKeyStore = {
    get: (type, ids) => keys.get(type, ids),
    set: async (data) => {
      await keys.set(data);
      await persist();
    },
  };

  if (keys.clear) {
    wrapped.clear = async () => {
      await keys.clear?.();
      await persist();
    };
  }

  return wrapped;
}

const WHATSAPP_CHANNEL = "WHATSAPP_BAILEYS" as const;

function whereFor(organizationId: string) {
  return {
    organizationId_channel: {
      organizationId,
      channel: WHATSAPP_CHANNEL,
    },
  };
}

export function createPrismaBaileysChannelRepository(
  database: Pick<PrismaClient, "channelConnection">,
): BaileysChannelRepository {
  return {
    async loadAuthState(organizationId) {
      const connection = await database.channelConnection.findUnique({
        where: whereFor(organizationId),
        select: { authState: true },
      });

      return parseAuthStateBundle(connection?.authState);
    },

    async saveAuthState(organizationId, bundle) {
      const existing = authStateRow(
        await database.channelConnection.findUnique({
          where: whereFor(organizationId),
          select: { authState: true, authStateVersion: true },
        }),
      );

      const existingState =
        existing.authState && typeof existing.authState === "object"
          ? (existing.authState as Record<string, unknown>)
          : {};

      const existingFiles =
        existingState.files && typeof existingState.files === "object"
          ? (existingState.files as Record<string, unknown>)
          : {};

      // Preserve the active pairing QR and merge credentials inside `files`:
      // Baileys fires `creds.update` while "attempting registration", and
      // overwriting the whole authState here would erase the QR the web
      // surface is showing. The shape must stay `{ files, ... }` for
      // `loadAuthState`/`restoreAuthState` to read it back.
      const nextAuthState: Record<string, unknown> = {
        ...existingState,
        files: {
          ...existingFiles,
          ...bundle.files,
        },
      };

      await database.channelConnection.upsert({
        where: whereFor(organizationId),
        create: {
          organizationId,
          channel: WHATSAPP_CHANNEL,
          authState: toInputJsonValue(bundle),
        },
        update: {
          authState: nextAuthState as unknown as Prisma.InputJsonValue,
          authStateVersion: { increment: 1 },
        },
      });
    },

    async ensureChannelConnection(organizationId) {
      await database.channelConnection.upsert({
        where: whereFor(organizationId),
        create: {
          organizationId,
          channel: WHATSAPP_CHANNEL,
          status: "NEEDS_PAIRING",
          authState: {},
        },
        update: {},
      });
    },

    async getChannelStatus(organizationId) {
      const connection = await database.channelConnection.findUnique({
        where: whereFor(organizationId),
        select: { status: true },
      });

      return connection?.status ?? null;
    },

    async updateChannelStatus(organizationId, status, lastConnectedAt) {
      await database.channelConnection.upsert({
        where: whereFor(organizationId),
        create: {
          organizationId,
          channel: WHATSAPP_CHANNEL,
          status,
          ...(lastConnectedAt ? { lastConnectedAt } : {}),
        },
        update: {
          status,
          ...(lastConnectedAt ? { lastConnectedAt } : {}),
        },
      });
    },

    async saveActiveQr(organizationId, qr) {
      const existing = authStateRow(
        await database.channelConnection.findUnique({
          where: whereFor(organizationId),
          select: { authState: true, authStateVersion: true },
        }),
      );

      const existingState =
        existing.authState && typeof existing.authState === "object"
          ? (existing.authState as Record<string, unknown>)
          : {};

      const nextAuthState: Record<string, unknown> = {
        ...existingState,
        [ACTIVE_QR_KEY]: { qr, createdAt: new Date().toISOString() },
      };

      await database.channelConnection.upsert({
        where: whereFor(organizationId),
        create: {
          organizationId,
          channel: WHATSAPP_CHANNEL,
          status: "NEEDS_PAIRING",
          authState: nextAuthState as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: "NEEDS_PAIRING",
          authState: nextAuthState as unknown as Prisma.InputJsonValue,
          authStateVersion: { increment: 1 },
        },
      });
    },

    async getActiveQr(organizationId) {
      const row = authStateRow(
        await database.channelConnection.findUnique({
          where: whereFor(organizationId),
          select: { authState: true, authStateVersion: true },
        }),
      );

      const active = extractActiveQr(row.authState);

      if (!active || Date.now() - active.createdAt.getTime() > QR_TTL_MS) {
        return null;
      }

      return { ...active, version: row.authStateVersion };
    },

    async clearActiveQr(organizationId, expectedVersion) {
      const existing = authStateRow(
        await database.channelConnection.findUnique({
          where: whereFor(organizationId),
          select: { authState: true, authStateVersion: true },
        }),
      );

      if (
        existing.authStateVersion !== expectedVersion ||
        existing.authState === null ||
        typeof existing.authState !== "object"
      ) {
        return;
      }

      const nextAuthState = {
        ...(existing.authState as Record<string, unknown>),
      };
      delete nextAuthState[ACTIVE_QR_KEY];

      await database.channelConnection.update({
        where: whereFor(organizationId),
        data: {
          authState: nextAuthState as unknown as Prisma.InputJsonValue,
          authStateVersion: { increment: 1 },
        },
      });
    },

    async clearAuthState(organizationId) {
      const emptyState = {} as Prisma.InputJsonValue;

      await database.channelConnection.upsert({
        where: whereFor(organizationId),
        create: {
          organizationId,
          channel: WHATSAPP_CHANNEL,
          status: "NEEDS_PAIRING",
          authState: emptyState,
        },
        update: {
          status: "NEEDS_PAIRING",
          authState: emptyState,
          authStateVersion: { increment: 1 },
        },
      });
    },

    async listOrganizationIds() {
      const rows = await database.channelConnection.findMany({
        where: { channel: WHATSAPP_CHANNEL },
        select: { organizationId: true },
      });
      return rows.map((row) => row.organizationId);
    },
  };
}

export { extractActiveQr } from "~/server/channels/qr-broker";

async function createTempAuthDir(authDirectory: string): Promise<string> {
  await mkdir(authDirectory, { recursive: true });
  return mkdtemp(join(authDirectory, "trayek-baileys-"));
}

function createPersistScheduler(
  repository: BaileysSessionRepository,
  organizationId: string,
  directory: string,
) {
  let disposed = false;
  let persistQueue = Promise.resolve();

  const persist = (): Promise<void> => {
    const next = persistQueue.then(async () => {
      if (disposed) throw new Error("BAILEYS_SESSION_DISPOSED");
      await repository.saveAuthState(
        organizationId,
        await readAuthState(directory),
      );
    });

    persistQueue = next.catch((error: unknown) => {
      reporter.reportError(error, "Baileys auth state persistence failed", {
        organizationId,
      });
    });
    return next;
  };

  return {
    persist,
    markDisposed() {
      disposed = true;
    },
    get disposed() {
      return disposed;
    },
  };
}

export async function createBaileysSession({
  organizationId,
  repository,
  authDirectory = tmpdir(),
}: CreateBaileysSessionOptions): Promise<BaileysSession> {
  const directory = await createTempAuthDir(authDirectory);
  const persisted = await repository.loadAuthState(organizationId);

  await restoreAuthState(directory, persisted);

  const { state, saveCreds: writeCreds } =
    await loadMultiFileAuthState(directory);
  const scheduler = createPersistScheduler(
    repository,
    organizationId,
    directory,
  );

  return {
    state: {
      ...state,
      keys: wrapKeyStore(state.keys, scheduler.persist),
    },

    async saveCreds() {
      await writeCreds();
      await scheduler.persist();
    },

    async dispose(options = { persist: true }) {
      if (scheduler.disposed) return;

      try {
        if (options.persist) await scheduler.persist();
      } finally {
        scheduler.markDisposed();
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
