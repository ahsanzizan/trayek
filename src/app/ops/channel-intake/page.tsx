import { Suspense } from "react";
import { redirect } from "next/navigation";

import { auth } from "~/server/auth";
import { channelTypeValues } from "~/server/domain/ports/channel";
import { api, HydrateClient } from "~/trpc/server";
import { MessageHistory } from "./_components/message-history";
import { WhatsappPairing } from "./_components/whatsapp-pairing";

export const metadata = {
  title: "Channel intake · Trayek Settle",
};

export default async function ChannelIntakePage() {
  const session = await auth();

  if (!session?.user?.activeOrganizationId) {
    redirect("/login?callbackUrl=/ops/channel-intake");
  }

  void api.channel.status.prefetch({ channel: channelTypeValues[0] });
  void api.channel.intake.prefetch({ channel: channelTypeValues[0] });

  return (
    <main className="bg-background text-text-primary min-h-screen antialiased">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-6 py-10 lg:px-12">
        <header>
          <p className="text-text-muted text-xs font-medium tracking-[0.14em] uppercase">
            Operasi / Channel
          </p>
          <h1 className="mt-3 text-3xl font-medium tracking-[-0.03em]">
            Channel intake
          </h1>
          <p className="text-text-secondary mt-2 max-w-[66ch] text-sm leading-6">
            Pantau koneksi WhatsApp dan lihat riwayat pesan masuk dan keluar
            untuk organisasi aktif.
          </p>
        </header>

        <HydrateClient>
          <Suspense
            fallback={
              <div className="border-border-subtle bg-surface text-text-muted rounded-[var(--radius-card)] border p-6 text-sm">
                Memuat status channel WhatsApp…
              </div>
            }
          >
            <WhatsappPairing />
            <MessageHistory />
          </Suspense>
        </HydrateClient>
      </div>
    </main>
  );
}
