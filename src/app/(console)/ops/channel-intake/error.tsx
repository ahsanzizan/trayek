"use client";

import { useEffect } from "react";

export default function ChannelIntakeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client error boundary log
  }, [error]);

  return (
    <main className="bg-background text-text-primary min-h-screen antialiased">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-6 py-10 lg:px-12">
        <section className="border-border-subtle bg-surface rounded-[var(--radius-card)] border p-6">
          <h1 className="text-text-primary text-xl font-medium">
            Terjadi kendala saat memuat halaman
          </h1>
          <p className="text-text-secondary mt-2 max-w-[66ch] text-sm leading-6">
            Coba muat ulang halaman. Jika masih terjadi, hubungi admin.
          </p>
          <button
            type="button"
            onClick={reset}
            className="border-border-strong text-text-primary mt-4 min-h-11 rounded-[var(--radius-control)] border px-4 text-sm font-medium"
          >
            Muat ulang
          </button>
        </section>
      </div>
    </main>
  );
}
