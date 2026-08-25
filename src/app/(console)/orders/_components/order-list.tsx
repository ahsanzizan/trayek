"use client";

import { api } from "~/trpc/react";

/**
 * `Intl.NumberFormat` formats a BigInt directly, so rendering an amount needs
 * no conversion and no division. That is what keeps the display path free of
 * arithmetic on `nilaiTagihan` (INV-3).
 */
const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const jakarta = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeZone: "Asia/Jakarta",
});

const STATUS_LABELS = {
  CREATED: "Dibuat",
  IN_TRANSIT: "Dalam perjalanan",
  DELIVERED: "Terkirim",
  POD_RECEIVED: "POD diterima",
  POD_VALIDATED: "POD tervalidasi",
  PACKET_READY: "Berkas siap",
  INVOICED: "Ditagihkan",
  PAID: "Dibayar",
  REJECTED: "Ditolak",
} as const;

export function OrderList() {
  const [page] = api.order.list.useSuspenseQuery({});

  if (page.orders.length === 0) {
    return (
      <p className="text-muted-foreground border-border-subtle rounded-[var(--radius-card)] border border-dashed p-8 text-sm">
        Belum ada order. Tambahkan satu untuk mulai mencocokkan POD.
      </p>
    );
  }

  return (
    <div className="border-border-subtle overflow-x-auto rounded-[var(--radius-card)] border">
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground border-border-subtle border-b">
          <tr>
            <th scope="col" className="px-4 py-3 font-normal">
              Surat jalan
            </th>
            <th scope="col" className="px-4 py-3 font-normal">
              Shipper
            </th>
            <th scope="col" className="px-4 py-3 font-normal">
              Rute
            </th>
            <th scope="col" className="px-4 py-3 font-normal">
              Driver
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Nilai tagihan
            </th>
            <th scope="col" className="px-4 py-3 font-normal">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {page.orders.map((order) => (
            <tr
              key={order.id}
              className="border-border-subtle border-b last:border-b-0"
            >
              <td className="px-4 py-3">
                <span className="font-mono text-xs">
                  {order.nomorSuratJalan}
                </span>
                <span className="text-muted-foreground block font-mono text-xs">
                  {jakarta.format(order.createdAt)}
                </span>
              </td>
              <td className="px-4 py-3">{order.shipper.name}</td>
              <td className="text-muted-foreground px-4 py-3">
                {order.origin} → {order.destination}
              </td>
              <td className="px-4 py-3">
                {order.driver?.name ?? (
                  <span className="text-muted-foreground">belum ditunjuk</span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {order.nilaiTagihan === null
                  ? "—"
                  : rupiah.format(order.nilaiTagihan)}
              </td>
              <td className="px-4 py-3">{STATUS_LABELS[order.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
