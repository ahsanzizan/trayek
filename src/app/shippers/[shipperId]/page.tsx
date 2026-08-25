import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { ProfilePanel } from "./_components/profile-panel";

export const metadata = {
  title: "Profil syarat shipper · Trayek Settle",
};

export default async function ShipperDetailPage({
  params,
}: {
  params: Promise<{ shipperId: string }>;
}) {
  const { shipperId } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/login?callbackUrl=/shippers/${shipperId}`);
  }

  const shipper = await api.shipper.byId({ shipperId }).catch((error) => {
    // A shipper belonging to another organization resolves as NOT_FOUND, so it
    // renders as a missing page rather than an error.
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  });

  void api.shipper.listProfileVersions.prefetch({ shipperId });

  return (
    <main className="bg-background text-foreground min-h-screen antialiased">
      <div className="mx-auto w-full max-w-[1100px] px-6 py-12">
        <Link
          href="/shippers"
          className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-[1.4px] uppercase"
        >
          ← Semua shipper
        </Link>

        <h1 className="mt-4 text-3xl font-normal tracking-[-0.8px]">
          {shipper.name}
        </h1>
        <dl className="text-muted-foreground mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {shipper.npwp && (
            <div className="flex gap-2">
              <dt>NPWP</dt>
              <dd className="font-mono">{shipper.npwp}</dd>
            </div>
          )}
          {shipper.financeContactName && (
            <div className="flex gap-2">
              <dt>Finance</dt>
              <dd>{shipper.financeContactName}</dd>
            </div>
          )}
        </dl>

        <HydrateClient>
          <ProfilePanel shipperId={shipperId} />
        </HydrateClient>
      </div>
    </main>
  );
}
