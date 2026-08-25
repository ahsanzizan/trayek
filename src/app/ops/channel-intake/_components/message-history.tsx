"use client";

import { api } from "~/trpc/react";

const STATUS_LABELS = {
  PENDING: "Menunggu",
  SENT: "Terkirim",
  DELIVERED: "Diterima",
  FAILED: "Gagal",
} as const;

const DIRECTION_LABELS = {
  INBOUND: "Masuk",
  OUTBOUND: "Keluar",
} as const;

const jakarta = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function MessageHistory() {
  const [page] = api.channel.intake.useSuspenseQuery({
    channel: "WHATSAPP_BAILEYS",
  });

  if (page.messages.length === 0) {
    return (
      <section className="border-border-subtle rounded-[var(--radius-card)] border border-dashed p-8">
        <h2 className="text-text-primary text-base font-medium">
          Belum ada pesan
        </h2>
        <p className="text-text-muted mt-2 text-sm">
          Pesan yang masuk atau dikirim lewat channel ini akan muncul di sini.
        </p>
      </section>
    );
  }

  return (
    <section className="border-border-subtle overflow-x-auto rounded-[var(--radius-card)] border">
      <table className="w-full text-left text-sm">
        <caption className="text-text-primary px-4 py-4 text-left font-medium">
          Riwayat intake WhatsApp
        </caption>
        <thead className="text-text-muted border-border-subtle border-y text-xs font-medium tracking-[0.14em] uppercase">
          <tr>
            <th scope="col" className="px-4 py-3">
              Waktu
            </th>
            <th scope="col" className="px-4 py-3">
              Arah
            </th>
            <th scope="col" className="px-4 py-3">
              Pesan
            </th>
            <th scope="col" className="px-4 py-3">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {page.messages.map((message) => (
            <tr
              key={message.id}
              className="border-border-subtle text-text-secondary border-b last:border-b-0"
            >
              <td className="text-text-muted px-4 py-3 whitespace-nowrap">
                {jakarta.format(message.createdAt)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {DIRECTION_LABELS[message.direction]}
              </td>
              <td className="max-w-[440px] px-4 py-3">
                <span className="line-clamp-2">
                  {message.body ?? "Pesan media atau tanpa teks"}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {STATUS_LABELS[message.status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
