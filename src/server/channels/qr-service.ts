import { type PrismaClient } from "~/generated/prisma";

import {
  channelQrBroker,
  extractActiveQr,
  QR_TTL_MS,
  type QrPayload,
  type QrStreamPayload,
} from "./qr-broker";
import { qrDataUrl } from "./qr-code";
import { logger } from "~/server/observability/logger";

type QrSource = Pick<
  PrismaClient["channelConnection"],
  "findFirst" | "findUnique" | "update"
>;

function isFresh(payload: Pick<QrPayload, "createdAt">, now: number): boolean {
  return now - payload.createdAt.getTime() <= QR_TTL_MS;
}

/**
 * Resolve the current pairing QR for an organization from a transport-neutral
 * source. In-process listeners get the live broker event; cross-process
 * consumers (web polling) fall back to the persisted `_activeQr`.
 */
export async function getQrPayload(
  organizationId: string,
  database: QrSource,
  now: number = Date.now(),
): Promise<QrPayload | null> {
  const latest = channelQrBroker.latest(organizationId);

  if (latest && isFresh(latest, now)) {
    return {
      version: latest.version,
      qr: latest.qr,
      createdAt: latest.createdAt,
    };
  }

  const conn = await database.findFirst({
    where: { organizationId, channel: "WHATSAPP_BAILEYS" },
    select: { authState: true, authStateVersion: true },
  });

  const active = extractActiveQr(conn?.authState);

  if (!active || !isFresh(active, now)) {
    return null;
  }

  return {
    version: conn?.authStateVersion ?? 1,
    qr: active.qr,
    createdAt: active.createdAt,
  };
}

function toStreamPayload(payload: QrPayload, dataUrl: string): QrStreamPayload {
  return {
    version: payload.version,
    dataUrl,
    createdAt: payload.createdAt.toISOString(),
  };
}

/** Send one QR payload to the stream, honoring freshness and last-sent dedup. */
async function sendQr(
  organizationId: string,
  payload: QrPayload,
  database: QrSource,
  lastSentVersion: { current: number },
  enqueue: (payload: QrStreamPayload) => void,
): Promise<void> {
  if (lastSentVersion.current >= payload.version) {
    return;
  }

  const dataUrl = await qrDataUrl(payload.qr);
  lastSentVersion.current = payload.version;
  enqueue(toStreamPayload(payload, dataUrl));
}

function emitCleared(emit: { next: (value: QrStreamPayload) => void }) {
  emit.next({ version: 0, dataUrl: "", createdAt: "" });
}

/**
 * Shared QR SSE stream used by the REST route and the tRPC subscription.
 * Polls the database at `intervalMs` to bridge the worker/web process
 * boundary, pushes live broker events when they arrive, and emits a
 * `dataUrl:""` cleared payload when pairing succeeds.
 */
export function createQrSseStream(
  organizationId: string,
  database: QrSource,
  intervalMs: number,
  signal?: AbortSignal,
): {
  start(emit: {
    next: (payload: QrStreamPayload) => void;
    complete: () => void;
  }): void;
  stop(): void;
} {
  const lastSentVersion = { current: 0 };
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeCleared: (() => void) | undefined;
  let interval: ReturnType<typeof setInterval> | null = null;

  const checkDb = async (emit: {
    next: (payload: QrStreamPayload) => void;
  }) => {
    if (closed) {
      return;
    }

    try {
      const payload = await getQrPayload(organizationId, database);

      if (payload) {
        await sendQr(organizationId, payload, database, lastSentVersion, (p) =>
          emit.next(p),
        );
      } else if (lastSentVersion.current > 0) {
        lastSentVersion.current = 0;
        emitCleared(emit);
      }
    } catch (error) {
      logger.warn("QR DB poll failed", { organizationId, error });
    }
  };

  return {
    start(emit) {
      const complete = () => {
        if (closed) {
          return;
        }

        closed = true;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        unsubscribe?.();
        unsubscribeCleared?.();
        emit.complete();
      };

      unsubscribeCleared = channelQrBroker.subscribeCleared((event) => {
        if (event.organizationId === organizationId) {
          lastSentVersion.current = 0;
          emitCleared(emit);
        }
      });

      void checkDb(emit);

      interval = setInterval(() => void checkDb(emit), intervalMs);

      unsubscribe = channelQrBroker.subscribe(organizationId, (event) => {
        void sendQr(
          organizationId,
          {
            version: event.version,
            qr: event.qr,
            createdAt: event.createdAt,
          },
          database,
          lastSentVersion,
          (p) => emit.next(p),
        ).catch(() => complete());
      });

      signal?.addEventListener("abort", complete, { once: true });
    },
    stop() {
      if (closed) {
        return;
      }

      closed = true;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      unsubscribe?.();
      unsubscribeCleared?.();
    },
  };
}
