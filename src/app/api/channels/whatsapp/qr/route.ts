import { type NextRequest } from "next/server";

import { auth } from "~/server/auth";
import { createQrSseStream } from "~/server/channels/qr-service";
import { createTRPCContext } from "~/server/api/trpc";
import { resolveMembership } from "~/server/auth/membership";
import { db } from "~/server/db";

const QR_POLL_INTERVAL_MS = 2_000;

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const organizationId =
    request.nextUrl.searchParams.get("organizationId") ??
    session.user.activeOrganizationId;

  if (!organizationId) {
    return new Response("Forbidden", { status: 403 });
  }

  const membership = await resolveMembership(
    db,
    session.user.id,
    organizationId,
  );

  if (!membership) {
    return new Response("Forbidden", { status: 403 });
  }

  const ctx = await createTRPCContext({
    headers: request.headers,
    session,
    db,
  });

  if (!ctx.session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const stream = createQrSseStream(
    organizationId,
    ctx.db.channelConnection,
    QR_POLL_INTERVAL_MS,
    request.signal,
  );

  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.start({
        next(payload) {
          if (payload.dataUrl === "") {
            controller.enqueue(
              encoder.encode(`event: qr_cleared\ndata: {}\n\n`),
            );
            return;
          }

          controller.enqueue(
            encoder.encode(`event: qr\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        },
        complete() {
          controller.close();
        },
      });
    },
    cancel() {
      stream.stop();
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Accel-Buffering": "no",
    },
  });
}
