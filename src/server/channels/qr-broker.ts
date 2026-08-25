export const ACTIVE_QR_KEY = "_activeQr" as const;

export const QR_TTL_MS = 30_000;

export interface QrPayload {
  version: number;
  qr: string;
  createdAt: Date;
}

export interface QrStreamPayload {
  version: number;
  dataUrl: string;
  createdAt: string;
}

export function extractActiveQr(
  authState: unknown,
): { qr: string; createdAt: Date } | null {
  if (
    authState &&
    typeof authState === "object" &&
    ACTIVE_QR_KEY in authState
  ) {
    const raw = (
      authState as { _activeQr?: { qr?: string; createdAt?: string } }
    )._activeQr;

    if (raw?.qr) {
      return {
        qr: raw.qr,
        createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
      };
    }
  }

  return null;
}

export interface QrEvent {
  organizationId: string;
  qr: string;
  version: number;
  createdAt: Date;
}

export interface QrEventInput {
  organizationId: string;
  qr: string;
  createdAt?: Date;
}

export type QrEventListener = (event: QrEvent) => void;

export type QrClearedListener = (event: { organizationId: string }) => void;

export interface QrBroker {
  publish(input: QrEventInput): QrEvent;
  latest(organizationId: string): QrEvent | null;
  clear(organizationId: string): void;
  subscribe(organizationId: string, listener: QrEventListener): () => void;
  subscribeCleared(listener: QrClearedListener): () => void;
}

export function createQrBroker(clock: () => Date = () => new Date()): QrBroker {
  const latestByOrganization = new Map<string, QrEvent>();
  const listenersByOrganization = new Map<string, Set<QrEventListener>>();
  const clearedListeners = new Set<QrClearedListener>();

  return {
    publish(input) {
      const previous = latestByOrganization.get(input.organizationId);
      const event: QrEvent = {
        organizationId: input.organizationId,
        qr: input.qr,
        version: (previous?.version ?? 0) + 1,
        createdAt: input.createdAt ?? clock(),
      };

      latestByOrganization.set(input.organizationId, event);

      for (const listener of listenersByOrganization.get(
        input.organizationId,
      ) ?? []) {
        listener(event);
      }

      return event;
    },

    latest(organizationId) {
      const event = latestByOrganization.get(organizationId);

      if (!event || clock().getTime() - event.createdAt.getTime() > QR_TTL_MS) {
        return null;
      }

      return event;
    },

    clear(organizationId) {
      latestByOrganization.delete(organizationId);

      for (const listener of clearedListeners) {
        listener({ organizationId });
      }
    },

    subscribe(organizationId, listener) {
      const listeners =
        listenersByOrganization.get(organizationId) ??
        new Set<QrEventListener>();
      listeners.add(listener);
      listenersByOrganization.set(organizationId, listeners);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByOrganization.delete(organizationId);
        }
      };
    },

    subscribeCleared(listener) {
      clearedListeners.add(listener);

      return () => {
        clearedListeners.delete(listener);
      };
    },
  };
}

export const channelQrBroker = createQrBroker();
