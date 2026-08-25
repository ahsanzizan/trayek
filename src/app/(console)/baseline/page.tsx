import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { BaselineWizard } from "./_components/baseline-wizard";

export const metadata = {
  title: "Baseline DSO · Trayek Settle",
};

export default async function BaselinePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/baseline");
  }

  void api.baseline.current.prefetch({});

  return (
    <main className="bg-background text-foreground min-h-screen antialiased">
      <div className="mx-auto w-full max-w-[900px] px-6 py-12">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-[1.4px] uppercase"
        >
          Trayek
        </Link>

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-3xl font-normal tracking-[-0.8px]">
            Baseline DSO
          </h1>
          <Link
            href="/baseline/cetak"
            className="border-border-strong hover:border-border-strong/80 rounded-full border px-4 py-1.5 text-sm"
          >
            Lihat ringkasan cetak
          </Link>
        </div>

        <p className="text-muted-foreground mt-2 max-w-[640px] text-sm leading-6">
          Angka awal sebelum Trayek mengubah apa pun. Tanpa ini, klaim
          &ldquo;DSO turun 8 hari&rdquo; di bulan ke-8 hanya jadi perdebatan.
          Sekali dikunci, angka ini tidak bisa diubah.
        </p>

        <div className="mt-10">
          <HydrateClient>
            <BaselineWizard />
          </HydrateClient>
        </div>
      </div>
    </main>
  );
}
