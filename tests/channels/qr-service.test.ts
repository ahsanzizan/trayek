import { describe, expect, it, vi } from "vitest";

import { createQrSseStream, getQrPayload } from "~/server/channels/qr-service";
import { channelQrBroker, QR_TTL_MS } from "~/server/channels/qr-broker";

type QrSource = {
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function createSource(): QrSource {
  return {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

// The stream only uses findFirst; the other methods exist to satisfy the
// structural type of the Prisma channelConnection delegate.
function asQrSource(source: QrSource) {
  return source as unknown as Parameters<typeof createQrSseStream>[1];
}

describe("QR payload resolution", () => {
  it("returns the persisted active QR with its version when the broker is empty", async () => {
    const source = createSource();
    source.findFirst.mockResolvedValue({
      authState: {
        _activeQr: { qr: "qr-persisted", createdAt: new Date().toISOString() },
      },
      authStateVersion: 7,
    });

    const payload = await getQrPayload("org-a", asQrSource(source), Date.now());

    expect(payload).toMatchObject({
      qr: "qr-persisted",
      version: 7,
    });
  });

  it("returns null when the persisted QR is older than the TTL", async () => {
    const source = createSource();
    source.findFirst.mockResolvedValue({
      authState: {
        _activeQr: {
          qr: "qr-stale",
          createdAt: new Date(Date.now() - QR_TTL_MS - 1_000).toISOString(),
        },
      },
      authStateVersion: 3,
    });

    const payload = await getQrPayload("org-a", asQrSource(source), Date.now());

    expect(payload).toBeNull();
  });

  it("prefers the live broker event over stale database state", async () => {
    const source = createSource();
    source.findFirst.mockResolvedValue({
      authState: {
        _activeQr: { qr: "qr-stale", createdAt: new Date().toISOString() },
      },
      authStateVersion: 3,
    });
    channelQrBroker.publish({ organizationId: "org-a", qr: "qr-live" });

    const payload = await getQrPayload("org-a", asQrSource(source), Date.now());

    expect(payload).toMatchObject({ qr: "qr-live", version: 1 });
  });
});

describe("QR stream", () => {
  it("emits a cleared payload after the live QR is cleared", async () => {
    const source = createSource();
    const events: Array<{ version: number; dataUrl: string }> = [];
    const stream = createQrSseStream("org-a", asQrSource(source), 60_000);

    channelQrBroker.publish({ organizationId: "org-a", qr: "qr-1" });
    stream.start({
      next(payload) {
        events.push(payload);
      },
      complete() {
        events.push({ version: -1, dataUrl: "complete" });
      },
    });

    await vi.waitFor(() => {
      expect(events.some((e) => e.dataUrl.startsWith("data:image/png"))).toBe(
        true,
      );
    });

    channelQrBroker.clear("org-a");

    await vi.waitFor(() => {
      expect(events.some((e) => e.dataUrl === "")).toBe(true);
    });

    stream.stop();
  });

  it("dedupes by version, not by QR string", async () => {
    const source = createSource();
    const events: Array<{ version: number; dataUrl: string }> = [];
    const stream = createQrSseStream("org-a", asQrSource(source), 60_000);

    stream.start({
      next(payload) {
        events.push(payload);
      },
      complete() {},
    });

    channelQrBroker.publish({ organizationId: "org-a", qr: "qr-a" });
    await vi.waitFor(() => expect(events).toHaveLength(1));

    channelQrBroker.publish({ organizationId: "org-a", qr: "qr-b" });
    await vi.waitFor(() => expect(events).toHaveLength(2));

    channelQrBroker.publish({ organizationId: "org-a", qr: "qr-a" });
    await vi.waitFor(() => expect(events).toHaveLength(3));

    stream.stop();
  });
});
