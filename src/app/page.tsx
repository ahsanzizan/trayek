import Link from "next/link";

import { NoOrganization } from "~/app/_components/no-organization";
import { SignOutForm } from "~/app/_components/sign-out-form";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-12">
        <section className="border-border-subtle bg-surface flex w-full max-w-md flex-col gap-4 rounded-[var(--radius-card)] border p-6">
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">Console operasional</p>
            <h1 className="text-title-lg font-semibold">Trayek</h1>
            <p className="text-muted-foreground text-sm leading-6">
              Masuk untuk mengelola operasi transportasi Anda.
            </p>
          </div>
          <Link
            href="/login"
            className={cn(
              buttonVariants({ size: "lg" }),
              "w-fit rounded-[var(--radius-control)]",
            )}
          >
            Masuk
          </Link>
        </section>
      </main>
    );
  }

  if (!session.user.activeOrganizationId) {
    return <NoOrganization />;
  }

  const memberships = await api.organization.listMemberships();
  const activeMembership = memberships.find(
    (membership) =>
      membership.organizationId === session.user.activeOrganizationId,
  );
  const organizationName =
    activeMembership?.organization.name ?? "Organisasi aktif";

  return (
    <main className="bg-background text-foreground flex min-h-[calc(100svh-3.5rem)] items-center justify-center px-4 py-12">
      <section className="border-border-subtle bg-surface flex w-full max-w-md flex-col gap-5 rounded-[var(--radius-card)] border p-6">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">Organisasi aktif</p>
          <h1 className="text-title-lg font-semibold">{organizationName}</h1>
          <p className="text-muted-foreground text-sm leading-6">
            Ruang kerja Anda siap digunakan.
          </p>
        </div>
        <SignOutForm className="w-fit rounded-[var(--radius-control)]" />
      </section>
    </main>
  );
}
