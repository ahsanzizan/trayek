import { type NextRequest } from "next/server";

import { auth } from "~/server/auth";
import { channelQrBroker, type QrEvent } from "~/server/channels/qr-broker";
import { qrDataUrl } from "~/server/channels/qr-code";

function canAccessOrganization(
  user: {
    activeOrganizationId: string | null;
  },
  memberships: readonly { organizationId: string }[],
  organizationId: string,
): boolean {
  return (
    user.activeOrganizationId === organizationId ||
    memberships.some(
      (membership) => membership.organizationId === organizationId,
    )
  );
}

function eventPayload(event: QrEvent, dataUrl: string): string {
  return JSON.stringify({
    version: event.version,
    dataUrl,
    createdAt: event.createdAt.toISOString(),
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const organizationId =
    request.nextUrl.searchParams.get("organizationId") ??
    session.user.activeOrganizationId;

  if (
    !organizationId ||
    !canAccessOrganization(session.user, session.memberships, organizationId)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  let unsubscribe = (): void => undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        unsubscribe();
        controller.close();
      };

      const send = async (event: QrEvent) => {
        if (closed) {
          return;
        }

        const dataUrl = await qrDataUrl(event.qr);
        if (closed) {
          return;
        }

        controller.enqueue(
          encoder.encode(
            `event: qr\ndata: ${eventPayload(event, dataUrl)}\n\n`,
          ),
        );
      };

      const latest = channelQrBroker.latest(organizationId);
      if (latest) {
        void send(latest).catch(close);
      }

      unsubscribe = channelQrBroker.subscribe(organizationId, (event) => {
        void send(event).catch(close);
      });

      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      closed = true;
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Accel-Buffering": "no",
    },
  });
}
