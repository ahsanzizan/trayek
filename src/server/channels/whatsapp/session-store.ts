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

import { type Prisma, type PrismaClient } from "../../../../generated/prisma";
import {
  channelConnectionStatusValues,
  type ChannelConnectionStatus,
} from "~/server/domain/ports/channel";

export { channelConnectionStatusValues, type ChannelConnectionStatus };

export interface AuthStateBundle {
  files: Record<string, Prisma.JsonValue>;
}

export interface BaileysSessionRepository {
  loadAuthState(organizationId: string): Promise<AuthStateBundle | null>;
  saveAuthState(organizationId: string, bundle: AuthStateBundle): Promise<void>;
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
}

export interface BaileysSession {
  state: AuthenticationState;
  saveCreds(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateBaileysSessionOptions {
  organizationId: string;
  repository: BaileysSessionRepository;
  authDirectory?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

    const value: unknown = JSON.parse(
      await readFile(join(directory, entry.name), "utf8"),
    );

    if (!isJsonValue(value)) {
      throw new Error("INVALID_BAILEYS_AUTH_STATE");
    }

    files[entry.name] = value;
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

export function createPrismaBaileysChannelRepository(
  database: Pick<PrismaClient, "channelConnection">,
): BaileysChannelRepository {
  return {
    async loadAuthState(organizationId) {
      const connection = await database.channelConnection.findUnique({
        where: {
          organizationId_channel: {
            organizationId,
            channel: "WHATSAPP_BAILEYS",
          },
        },
        select: { authState: true },
      });

      return parseAuthStateBundle(connection?.authState);
    },

    async saveAuthState(organizationId, bundle) {
      await database.channelConnection.upsert({
        where: {
          organizationId_channel: {
            organizationId,
            channel: "WHATSAPP_BAILEYS",
          },
        },
        create: {
          organizationId,
          channel: "WHATSAPP_BAILEYS",
          authState: toInputJsonValue(bundle),
        },
        update: {
          authState: toInputJsonValue(bundle),
          authStateVersion: { increment: 1 },
        },
      });
    },

    async getChannelStatus(organizationId) {
      const connection = await database.channelConnection.findUnique({
        where: {
          organizationId_channel: {
            organizationId,
            channel: "WHATSAPP_BAILEYS",
          },
        },
        select: { status: true },
      });

      return connection?.status ?? null;
    },

    async updateChannelStatus(organizationId, status, lastConnectedAt) {
      await database.channelConnection.upsert({
        where: {
          organizationId_channel: {
            organizationId,
            channel: "WHATSAPP_BAILEYS",
          },
        },
        create: {
          organizationId,
          channel: "WHATSAPP_BAILEYS",
          status,
          ...(lastConnectedAt ? { lastConnectedAt } : {}),
        },
        update: {
          status,
          ...(lastConnectedAt ? { lastConnectedAt } : {}),
        },
      });
    },
  };
}

export async function createBaileysSession({
  organizationId,
  repository,
  authDirectory = tmpdir(),
}: CreateBaileysSessionOptions): Promise<BaileysSession> {
  await mkdir(authDirectory, { recursive: true });
  const directory = await mkdtemp(join(authDirectory, "trayek-baileys-"));
  const persisted = await repository.loadAuthState(organizationId);

  await restoreAuthState(directory, persisted);

  const { state, saveCreds: writeCreds } =
    await loadMultiFileAuthState(directory);
  let disposed = false;
  let persistQueue = Promise.resolve();

  const persist = (): Promise<void> => {
    const next = persistQueue.then(async () => {
      if (disposed) {
        throw new Error("BAILEYS_SESSION_DISPOSED");
      }

      await repository.saveAuthState(
        organizationId,
        await readAuthState(directory),
      );
    });

    persistQueue = next.catch(() => undefined);
    return next;
  };

  return {
    state: {
      ...state,
      keys: wrapKeyStore(state.keys, persist),
    },

    async saveCreds() {
      await writeCreds();
      await persist();
    },

    async dispose() {
      if (disposed) {
        return;
      }

      await persist();
      disposed = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
