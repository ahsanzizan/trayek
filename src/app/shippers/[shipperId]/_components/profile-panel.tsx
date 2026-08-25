"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { PublishProfileForm } from "./publish-profile-form";
import { VersionDiff } from "./version-diff";

const jakarta = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

export function ProfilePanel({ shipperId }: { shipperId: string }) {
  const [versions] = api.shipper.listProfileVersions.useSuspenseQuery({
    shipperId,
  });
  const [showForm, setShowForm] = useState(false);

  const active = versions.find((version) => version.supersededAt === null);

  return (
    <div className="mt-10 flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-normal">Riwayat versi profil</h2>
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="border-border-strong hover:border-border-strong/80 focus-visible:ring-ring rounded-full border px-4 py-1.5 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            {showForm ? "Tutup" : "Terbitkan versi baru"}
          </button>
        </div>

        {versions.length === 0 ? (
          <p className="text-muted-foreground border-border-subtle rounded-[var(--radius-card)] border border-dashed p-8 text-sm">
            Belum ada profil syarat. Terbitkan versi pertama supaya berkas tagih
            untuk shipper ini bisa divalidasi.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="border-border-subtle bg-card text-card-foreground flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-[var(--radius-card)] border p-4"
              >
                <span className="font-mono text-sm">v{version.version}</span>
                <span className="text-muted-foreground flex-1 text-sm">
                  {version.changeNote ?? "Tanpa catatan"}
                </span>
                <span className="text-muted-foreground font-mono text-xs">
                  {jakarta.format(version.createdAt)} WIB
                </span>
                <span
                  className={
                    version.supersededAt === null
                      ? "text-foreground font-mono text-xs"
                      : "text-muted-foreground font-mono text-xs"
                  }
                >
                  {version.supersededAt === null ? "aktif" : "digantikan"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showForm && (
        <PublishProfileForm
          shipperId={shipperId}
          // Starting from the active version means an admin edits what is in
          // force rather than retyping it, which is where mistakes come from.
          startFrom={active?.rules ?? null}
          onPublished={() => setShowForm(false)}
        />
      )}

      {versions.length >= 2 && (
        <VersionDiff
          shipperId={shipperId}
          versions={versions.map((version) => version.version)}
        />
      )}
    </div>
  );
}
