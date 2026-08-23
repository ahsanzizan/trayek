import { OrgSwitcher } from "~/app/_components/org-switcher";
import { SignOutForm } from "~/app/_components/sign-out-form";

export function UtilityBar() {
  return (
    <header className="border-border-subtle bg-background hidden h-14 items-center justify-between border-b px-6 md:flex">
      <span className="text-sm font-semibold tracking-tight">Trayek</span>
      <div className="flex items-center gap-3">
        <OrgSwitcher />
        <SignOutForm className="rounded-[var(--radius-control)]" />
      </div>
    </header>
  );
}
