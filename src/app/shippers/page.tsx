import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { CreateShipperForm } from "./_components/create-shipper-form";
import { ShipperList } from "./_components/shipper-list";

export const metadata = {
  title: "Shipper · Trayek Settle",
};

export default async function ShippersPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/shippers");
  }

  void api.shipper.list.prefetch();

  return (
    <main className="bg-background text-foreground min-h-screen antialiased">
      <div className="mx-auto w-full max-w-[1100px] px-6 py-12">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-[1.4px] uppercase"
        >
          Trayek
        </Link>

        <h1 className="mt-4 text-3xl font-normal tracking-[-0.8px]">Shipper</h1>
        <p className="text-muted-foreground mt-2 max-w-[640px] text-sm leading-6">
          Setiap shipper punya profil syarat sendiri. Profil inilah yang dipakai
          untuk memeriksa kelengkapan berkas tagih sebelum dikirim ke tim
          finance mereka.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
          <HydrateClient>
            <ShipperList />
          </HydrateClient>

          <CreateShipperForm />
        </div>
      </div>
    </main>
  );
}
