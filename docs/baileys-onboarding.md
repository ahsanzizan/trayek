# Baileys WhatsApp Worker

Baileys is the WhatsApp channel adapter for the current channel-worker
implementation. It is an unofficial WhatsApp Web integration, not the WABA
Cloud API. Do not use it for bulk messaging or unsolicited outreach.

## Local setup

1. Copy `.env.example` to `.env` and set the existing application secrets.
2. Keep `BAILEYS_AUTH_DIR` on a local path that the worker can read and write.
3. Leave `MAX_CHANNEL_SOCKETS` empty for the development default of 10, or set
   an explicit positive integer.
4. Start the web app and channel worker in separate terminals:

   ```bash
   pnpm dev
   pnpm worker:channels
   ```

The channel worker owns every Baileys WebSocket. The Next.js process must not
create a Baileys socket. A worker restart restores the per-organization
authentication bundle from `ChannelConnection.authState` into a temporary
multi-file auth directory before creating the socket.

## Pairing and recovery

- Open the channel-intake surface and scan the current QR from WhatsApp.
- The status `CONNECTED` is shown as “Terhubung”.
- A logged-out session becomes `NEEDS_PAIRING` and is shown as “Perlu pairing”.
- A connection replacement is closed without silently taking over the other
  session.
- Transient disconnects use bounded exponential reconnect attempts. A terminal
  reconnect failure creates a human fallback instruction in Bahasa Indonesia.

Baileys credentials, keys, QR payloads, message bodies, JIDs, and remote JIDs
must never be written to logs. The observability redactor treats authentication
state and channel identifiers as sensitive fields.

## Operational boundaries

- Keep the worker as a long-running process under the deployment supervisor
  (for example, a dedicated container or process manager). Do not run it as a
  serverless request handler.
- Warm up new numbers gradually and stay below the documented new-number
  throughput guidance. WhatsApp may restrict or ban unofficial automation.
- The current QR broker is process-local. A multi-process or multi-pod
  deployment needs a shared QR transport before it can claim reliable QR
  delivery across worker and web instances.
- Baileys has no Meta template or Meta billing category. Cost attribution must
  remain honest and must not fabricate WABA charges.
