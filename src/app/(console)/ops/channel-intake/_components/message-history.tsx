"use client";

import { useEffect, useState } from "react";

import { api } from "~/trpc/react";
import { channelTypeValues } from "~/server/domain/ports/channel";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { jakartaDateTime } from "~/lib/format";

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

export function MessageHistory() {
  const [pageHidden, setPageHidden] = useState(false);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const [page] = api.channel.intake.useSuspenseQuery(
    { channel: channelTypeValues[0] },
    { refetchInterval: pageHidden ? false : 3000 },
  );

  if (page.messages.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <h2 className="text-text-primary text-base font-medium">
            Belum ada pesan
          </h2>
          <p className="text-text-muted mt-2 text-sm">
            Pesan yang masuk atau dikirim lewat channel ini akan muncul di sini.
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <CardHeader className="border-border-subtle flex flex-row items-center justify-between border-b">
        <h2 className="text-text-primary text-base font-medium">
          Riwayat intake WhatsApp
        </h2>
        <span className="text-text-muted text-xs font-medium">
          {page.messages.length} pesan tercatat
        </span>
      </CardHeader>

      <CardContent className="max-h-[420px] overflow-x-auto overflow-y-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="text-text-muted bg-surface-raised border-border-subtle sticky top-0 z-10 border-b text-xs font-medium tracking-[0.14em] uppercase">
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
                className="border-border-subtle text-text-secondary hover:bg-surface-raised/40 border-b transition-colors last:border-b-0"
              >
                <td className="text-text-muted px-4 py-3 whitespace-nowrap">
                  {jakartaDateTime.format(message.createdAt)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={
                      message.direction === "INBOUND"
                        ? "text-success font-medium"
                        : "text-text-secondary"
                    }
                  >
                    {DIRECTION_LABELS[message.direction]}
                  </span>
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
      </CardContent>
    </Card>
  );
}
