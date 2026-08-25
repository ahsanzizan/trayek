import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "~/server/auth";
import { channelQrBroker } from "~/server/channels/qr-broker";
import { GET } from "~/app/api/channels/whatsapp/qr/route";

const authMock = auth as unknown as () => Promise<unknown>;

describe("WhatsApp QR stream", () => {
  it("requires an authenticated member of the requested organization", async () => {
    vi.mocked(authMock).mockResolvedValueOnce(null);

    await expect(
      GET(new NextRequest("https://example.test/api/channels/whatsapp/qr")),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("streams a QR data URL with privacy-safe response headers", async () => {
    vi.mocked(authMock).mockResolvedValueOnce({
      user: { id: "user-a", activeOrganizationId: "org-qr" },
      memberships: [],
      expires: "2099-01-01T00:00:00.000Z",
    });
    channelQrBroker.publish({ organizationId: "org-qr", qr: "qr-test" });

    const response = await GET(
      new NextRequest(
        "https://example.test/api/channels/whatsapp/qr?organizationId=org-qr",
      ),
    );
    const reader = response.body?.getReader();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(reader).toBeDefined();

    if (!reader) {
      return;
    }

    const chunk = await reader.read();
    const body = new TextDecoder().decode(chunk.value);

    expect(body).toContain("event: qr");
    expect(body).toContain('"dataUrl":"data:image/png;base64,');
    await reader.cancel();
  });
});
