"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { api } from "~/trpc/react";

type QrPayload = {
  version: number;
  dataUrl: string;
};

type StreamState = "connecting" | "waiting" | "ready" | "error";

const STATUS_LABELS = {
  CONNECTED: "Terhubung",
  DISCONNECTED: "Terputus",
  NEEDS_PAIRING: "Perlu pairing",
} as const;

const STATUS_STYLES = {
  CONNECTED: "border-success text-success bg-success-subtle/40",
  DISCONNECTED: "border-danger text-danger bg-danger-subtle/40",
  NEEDS_PAIRING: "border-warning text-warning bg-warning-subtle/40",
} as const;

function isQrPayload(value: unknown): value is QrPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.version === "number" &&
    typeof candidate.dataUrl === "string" &&
    candidate.dataUrl.startsWith("data:image/")
  );
}

export function WhatsappPairing() {
  const [connection] = api.channel.status.useSuspenseQuery({
    channel: "WHATSAPP_BAILEYS",
  });
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connecting");

  useEffect(() => {
    const stream = new EventSource("/api/channels/whatsapp/qr");

    const handleQr = (event: Event) => {
      if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
        return;
      }

      try {
        const payload: unknown = JSON.parse(event.data);

        if (isQrPayload(payload)) {
          setQr(payload);
          setStreamState("ready");
        }
      } catch {
        setStreamState("error");
      }
    };

    stream.addEventListener("qr", handleQr);
    stream.onerror = () => setStreamState("error");

    return () => {
      stream.removeEventListener("qr", handleQr);
      stream.close();
    };
  }, []);

  const status = connection?.status ?? "NEEDS_PAIRING";
  const statusLabel = STATUS_LABELS[status];

  return (
    <section className="border-border-subtle bg-surface rounded-[var(--radius-card)] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-text-muted text-xs font-medium tracking-[0.14em] uppercase">
            Channel WhatsApp
          </p>
          <h2 className="text-text-primary mt-2 text-xl font-medium">
            Hubungkan nomor operasional
          </h2>
          <p className="text-text-secondary mt-2 max-w-[66ch] text-sm leading-6">
            Scan QR dari aplikasi WhatsApp untuk mengaktifkan penerimaan dan
            pengiriman pesan dari console.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="border-border-subtle mt-6 grid gap-6 border-t pt-6 md:grid-cols-[220px_1fr]">
        <div className="bg-surface-raised relative flex aspect-square items-center justify-center rounded-[var(--radius-card)] p-4">
          {qr ? (
            <Image
              src={qr.dataUrl}
              alt="Kode QR untuk menghubungkan WhatsApp"
              fill
              unoptimized
              sizes="220px"
              className="rounded-[var(--radius-control)] object-contain p-4"
            />
          ) : (
            <p className="text-text-muted px-4 text-center text-sm">
              {streamState === "error"
                ? "Kode QR belum tersedia. Menghubungkan ke layanan WhatsApp…"
                : "Menyiapkan kode QR WhatsApp…"}
            </p>
          )}
        </div>

        <div className="flex flex-col justify-center gap-3 text-sm">
          <h3 className="text-text-primary font-medium">
            Cara menghubungkan WhatsApp
          </h3>
          <ol className="text-text-secondary list-inside list-decimal space-y-2 leading-6">
            <li>Buka WhatsApp di nomor operasional.</li>
            <li>Pilih Perangkat tertaut lalu Tautkan perangkat.</li>
            <li>Arahkan kamera ke QR yang tampil di sebelah kiri.</li>
          </ol>
          <p className="text-text-muted bg-warning-subtle/30 rounded-[var(--radius-control)] px-3 py-2 text-xs leading-5">
            Kode QR akan diperbarui secara otomatis jika sesi autentikasi
            kedaluwarsa atau memerlukan penautan ulang.
          </p>
        </div>
      </div>
    </section>
  );
}
