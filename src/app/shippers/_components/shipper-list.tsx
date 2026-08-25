"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

export function ShipperList() {
  const [shippers] = api.shipper.list.useSuspenseQuery();

  if (shippers.length === 0) {
    return (
      <p className="text-muted-foreground border-border-subtle rounded-[var(--radius-card)] border border-dashed p-8 text-sm">
        Belum ada shipper. Tambahkan satu untuk mulai menyusun profil syarat.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {shippers.map((shipper) => (
        <li key={shipper.id}>
          <Link
            href={`/shippers/${shipper.id}`}
            className="border-border-subtle bg-card text-card-foreground hover:border-border-strong focus-visible:ring-ring block rounded-[var(--radius-card)] border p-5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-base font-medium">{shipper.name}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {shipper.activeProfileVersion === null
                  ? "belum ada profil"
                  : `profil v${shipper.activeProfileVersion}`}
              </span>
            </div>
            {shipper.npwp && (
              <p className="text-muted-foreground mt-1 font-mono text-xs">
                NPWP {shipper.npwp}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
