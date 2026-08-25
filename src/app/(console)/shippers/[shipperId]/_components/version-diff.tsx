"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

/** Renders a rule value the way it appears in the profile, not as raw JSON. */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(", ");
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return JSON.stringify(value) ?? "—";
}

const KIND_LABELS = {
  ADDED: "Ditambah",
  REMOVED: "Dihapus",
  CHANGED: "Diubah",
} as const;

export function VersionDiff({
  shipperId,
  versions,
}: {
  shipperId: string;
  versions: number[];
}) {
  // Newest against the one before it: the comparison an admin wants by default.
  const [toVersion, setToVersion] = useState(versions[0] ?? 1);
  const [fromVersion, setFromVersion] = useState(versions[1] ?? 1);

  const diff = api.shipper.diffProfileVersions.useQuery(
    { shipperId, fromVersion, toVersion },
    { enabled: fromVersion !== toVersion },
  );

  const selectClasses =
    "border-border-strong bg-surface min-h-11 rounded-[var(--radius-control)] border px-3 text-sm";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-normal">Bandingkan versi</h2>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Dari</span>
          <select
            value={fromVersion}
            onChange={(event) => setFromVersion(Number(event.target.value))}
            className={selectClasses}
          >
            {versions.map((version) => (
              <option key={version} value={version}>
                v{version}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Ke</span>
          <select
            value={toVersion}
            onChange={(event) => setToVersion(Number(event.target.value))}
            className={selectClasses}
          >
            {versions.map((version) => (
              <option key={version} value={version}>
                v{version}
              </option>
            ))}
          </select>
        </label>
      </div>

      {fromVersion === toVersion ? (
        <p className="text-muted-foreground text-sm">
          Pilih dua versi yang berbeda.
        </p>
      ) : diff.isPending ? (
        <p className="text-muted-foreground text-sm">Memuat perbandingan…</p>
      ) : diff.isError ? (
        <p role="alert" className="text-destructive text-sm">
          Gagal memuat perbandingan.
        </p>
      ) : diff.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Tidak ada perbedaan syarat antara v{fromVersion} dan v{toVersion}.
        </p>
      ) : (
        <div className="border-border-subtle overflow-x-auto rounded-[var(--radius-card)] border">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground border-border-subtle border-b">
              <tr>
                <th scope="col" className="px-4 py-3 font-normal">
                  Syarat
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  Perubahan
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  v{fromVersion}
                </th>
                <th scope="col" className="px-4 py-3 font-normal">
                  v{toVersion}
                </th>
              </tr>
            </thead>
            <tbody>
              {diff.data.map((change) => (
                <tr
                  key={`${change.path}-${change.kind}`}
                  className="border-border-subtle border-b last:border-b-0"
                >
                  <td className="px-4 py-3 font-mono text-xs">{change.path}</td>
                  <td className="px-4 py-3">{KIND_LABELS[change.kind]}</td>
                  <td className="text-muted-foreground px-4 py-3">
                    {formatValue(change.before)}
                  </td>
                  <td className="px-4 py-3">{formatValue(change.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
