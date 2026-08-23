import { SignOutForm } from "~/app/_components/sign-out-form";

export function NoOrganization() {
  return (
    <main className="bg-background text-foreground flex min-h-[calc(100svh-3.5rem)] items-center justify-center px-4 py-12">
      <section className="border-border-subtle bg-surface flex w-full max-w-md flex-col gap-4 rounded-[var(--radius-card)] border p-6">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">Akses Trayek</p>
          <h1 className="text-title-sm font-semibold">
            Belum ada akses organisasi
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            Akun Anda belum terhubung ke organisasi mana pun. Hubungi admin
            organisasi Anda untuk diundang.
          </p>
        </div>
        <SignOutForm className="w-fit rounded-[var(--radius-control)]" />
      </section>
    </main>
  );
}
