import { type Metadata } from "next";
import { headers } from "next/headers";

import { LINK_REFUSAL_MESSAGES } from "~/server/domain/pod-link/access";
import { db } from "~/server/db";
import { resolveUploadLink } from "~/server/pod-link/resolve";

/**
 * The driver's entry point (TRK-024).
 *
 * No session, no sign-in, no account: the token in the path is the entire
 * authorization, which is what lets Pak Herman open this from a WhatsApp
 * message at a warehouse gate. Referrer and indexing are suppressed for this
 * path in `next.config.js`, so the token cannot leak through a Referer header
 * or a search index.
 *
 * The capture UI itself is TRK-030. What this renders on success is the
 * confirmation that the link is live and points at the order the driver
 * expects — the part TRK-030 builds its screen on top of.
 */

export const metadata: Metadata = {
  title: "Unggah POD · Trayek",
  robots: { index: false, follow: false },
};

/** The token makes every request unique; nothing here may be cached. */
export const dynamic = "force-dynamic";

/**
 * The client address as seen through a proxy. The leftmost entry of
 * `x-forwarded-for` is the original client; the rest are the proxies it passed
 * through. Absent behind a proxy that does not set it, in which case the
 * per-token limit still applies and the per-IP one is simply skipped.
 */
function clientAddress(requestHeaders: Headers): string | null {
  const forwardedFor = requestHeaders.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();

    if (first) {
      return first;
    }
  }

  return requestHeaders.get("x-real-ip");
}

function RefusalScreen({ message }: { message: string }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6 py-12 antialiased">
      <div className="w-full max-w-[420px] text-center">
        <p className="text-muted-foreground font-mono text-xs tracking-[1.4px] uppercase">
          Trayek
        </p>
        <h1 className="mt-6 text-2xl font-normal tracking-[-0.4px]">
          Tautan tidak dapat dibuka
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          {message}
        </p>
      </div>
    </main>
  );
}

export default async function PodUploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const requestHeaders = await headers();

  const result = await resolveUploadLink({
    db,
    token,
    ipAddress: clientAddress(requestHeaders),
  });

  if (!result.ok) {
    return <RefusalScreen message={LINK_REFUSAL_MESSAGES[result.reason]} />;
  }

  const { link } = result;

  return (
    <main className="bg-background text-foreground min-h-screen px-6 py-12 antialiased">
      <div className="mx-auto w-full max-w-[420px]">
        <p className="text-muted-foreground font-mono text-xs tracking-[1.4px] uppercase">
          Trayek
        </p>

        <h1 className="mt-6 text-2xl font-normal tracking-[-0.4px]">
          Unggah bukti terima barang
        </h1>

        <p className="text-muted-foreground mt-3 text-sm leading-6">
          Pastikan data di bawah sesuai dengan pengiriman Anda sebelum
          mengunggah foto POD.
        </p>

        <dl className="border-border mt-8 divide-y divide-dashed border-y border-dashed">
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-muted-foreground text-sm">Nomor order</dt>
            <dd className="font-mono text-sm">{link.nomorOrder}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-muted-foreground text-sm">Surat jalan</dt>
            <dd className="font-mono text-sm">{link.nomorSuratJalan}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-muted-foreground text-sm">Tujuan</dt>
            <dd className="text-right text-sm">{link.destination}</dd>
          </div>
        </dl>

        <p className="text-muted-foreground mt-8 text-sm leading-6">
          Sisa kesempatan unggah: {link.remainingUses}.
        </p>

        {/* TRK-030 replaces this with the camera capture screen. */}
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Halaman unggah foto sedang disiapkan. Jika Anda diminta mengirim POD
          sekarang, hubungi admin Anda.
        </p>
      </div>
    </main>
  );
}
