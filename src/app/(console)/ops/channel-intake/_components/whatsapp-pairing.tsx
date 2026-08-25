"use client";

import Image from "next/image";
import { AlertCircle, CheckCircle2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "~/trpc/react";
import { channelTypeValues } from "~/server/domain/ports/channel";
import { jakartaDateTime } from "~/lib/format";

import { useQrStream } from "./use-qr-stream";

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

const TITLE_BY_STATUS = {
  CONNECTED: "Nomor WhatsApp Operasional",
  DISCONNECTED: "Layanan WhatsApp Terputus",
  NEEDS_PAIRING: "Hubungkan nomor operasional",
} as const;

const DESCRIPTION_BY_STATUS = {
  CONNECTED:
    "Koneksi WhatsApp aktif dan siap menerima pesan dari driver serta mengirim notifikasi ke shipper.",
  DISCONNECTED:
    "Koneksi latar belakang ke server WhatsApp terputus. Layanan akan mencoba terhubung kembali secara otomatis saat aktif.",
  NEEDS_PAIRING:
    "Scan QR dari aplikasi WhatsApp untuk mengaktifkan penerimaan dan pengiriman pesan dari console.",
} as const;

function ConnectionStateRow({
  icon,
  title,
  description,
  iconClass,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  iconClass: string;
}) {
  return (
    <div className="border-border-subtle mt-6 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] ${iconClass}`}
        >
          {icon}
        </div>
        <div>
          <p className="text-text-primary text-sm font-medium">{title}</p>
          <p className="text-text-muted mt-1 text-xs">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function WhatsappPairing() {
  const [pageHidden, setPageHidden] = useState(false);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const [connection] = api.channel.status.useSuspenseQuery(
    { channel: channelTypeValues[0] },
    { refetchInterval: pageHidden ? false : 2000, staleTime: 0 },
  );

  const status = connection?.status ?? "NEEDS_PAIRING";
  const isConnected = status === "CONNECTED";
  const isDisconnected = status === "DISCONNECTED";
  const needsPairing = status === "NEEDS_PAIRING";
  const { qr, streamState } = useQrStream(needsPairing);

  const statusLabel = STATUS_LABELS[status];

  return (
    <section className="border-border-subtle bg-surface rounded-[var(--radius-card)] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-text-muted text-xs font-medium tracking-[0.14em] uppercase">
            Channel WhatsApp
          </p>
          <h2 className="text-text-primary mt-2 text-xl font-medium">
            {TITLE_BY_STATUS[status]}
          </h2>
          <p className="text-text-secondary mt-2 max-w-[66ch] text-sm leading-6">
            {DESCRIPTION_BY_STATUS[status]}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
        >
          {statusLabel}
        </span>
      </div>

      {isConnected && (
        <>
          <ConnectionStateRow
            icon={<CheckCircle2 className="h-6 w-6" />}
            iconClass="bg-success-subtle/20 text-success"
            title="WhatsApp Siap Digunakan"
            description={
              connection?.lastConnectedAt
                ? `Terhubung sejak ${jakartaDateTime.format(connection.lastConnectedAt)}`
                : "Koneksi aktif dan siap memproses pesan masuk"
            }
          />
          <div className="text-text-muted flex items-center justify-end gap-2 pt-2 text-xs">
            <Smartphone className="h-4 w-4" />
            <span>Perangkat tertaut aktif</span>
          </div>
        </>
      )}

      {isDisconnected && (
        <ConnectionStateRow
          icon={<AlertCircle className="h-6 w-6" />}
          iconClass="bg-danger-subtle/20 text-danger"
          title="Koneksi Latar Belakang Tidak Aktif"
          description="Sesi autentikasi tersimpan dengan aman. Sistem akan otomatis terhubung kembali saat layanan aktif."
        />
      )}

      {needsPairing && (
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
                  ? "Kode QR belum tersedia. Pastikan layanan WhatsApp aktif, lalu muat ulang halaman ini."
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
      )}
    </section>
  );
}
