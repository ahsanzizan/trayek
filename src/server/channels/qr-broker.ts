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

const QR_TTL_MS = 30_000;

export interface QrBroker {
  publish(input: QrEventInput): QrEvent;
  latest(organizationId: string): QrEvent | null;
  subscribe(organizationId: string, listener: QrEventListener): () => void;
}

export function createQrBroker(clock: () => Date = () => new Date()): QrBroker {
  const latestByOrganization = new Map<string, QrEvent>();
  const listenersByOrganization = new Map<string, Set<QrEventListener>>();

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
  };
}

export const channelQrBroker = createQrBroker();
