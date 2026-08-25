import { describe, expect, it } from "vitest";

import { createQrBroker } from "~/server/channels/qr-broker";

describe("channel QR broker", () => {
  it("keeps the latest QR per organization and notifies subscribers", () => {
    const broker = createQrBroker();
    const received: string[] = [];
    const unsubscribe = broker.subscribe("org-a", (event) => {
      received.push(`${event.organizationId}:${event.version}:${event.qr}`);
    });

    broker.publish({ organizationId: "org-a", qr: "qr-a" });
    broker.publish({ organizationId: "org-b", qr: "qr-b" });
    broker.publish({ organizationId: "org-a", qr: "qr-a-next" });

    expect(received).toEqual(["org-a:1:qr-a", "org-a:2:qr-a-next"]);
    expect(broker.latest("org-a")).toMatchObject({
      organizationId: "org-a",
      qr: "qr-a-next",
      version: 2,
    });
    expect(broker.latest("org-b")).toMatchObject({ qr: "qr-b", version: 1 });

    unsubscribe();
    broker.publish({ organizationId: "org-a", qr: "qr-a-last" });
    expect(received).toHaveLength(2);
  });

  it("does not replay a QR after its short pairing window expires", () => {
    let now = new Date("2026-08-25T00:00:00.000Z");
    const broker = createQrBroker(() => now);

    broker.publish({ organizationId: "org-expiring", qr: "qr-old" });
    now = new Date("2026-08-25T00:00:31.000Z");

    expect(broker.latest("org-expiring")).toBeNull();
  });
});
