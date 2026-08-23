import { Button } from "~/components/ui/button";
import { signOut } from "~/server/auth";

async function signOutAction() {
  "use server";

  await signOut({ redirectTo: "/login" });
}

export function SignOutForm({ className }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <Button
        type="submit"
        variant="outline"
        className={className ?? "rounded-[var(--radius-control)]"}
      >
        Keluar
      </Button>
    </form>
  );
}
