"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { Button, buttonVariants } from "~/components/ui/button";
import {
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRoot,
  MenuTrigger,
} from "~/components/ui/menu";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

export function OrgSwitcher() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const membershipsQuery = api.organization.listMemberships.useQuery(
    undefined,
    { enabled: status === "authenticated" },
  );
  const switchOrganizationMutation =
    api.organization.switchOrganization.useMutation();
  const utils = api.useUtils();
  const [switchError, setSwitchError] = useState(false);
  const [lastRequestedOrganizationId, setLastRequestedOrganizationId] =
    useState<string | null>(null);

  async function selectOrganization(organizationId: string) {
    if (
      organizationId === activeOrganizationId ||
      switchOrganizationMutation.isPending
    ) {
      return;
    }

    setSwitchError(false);
    setLastRequestedOrganizationId(organizationId);

    try {
      const result = await switchOrganizationMutation.mutateAsync({
        organizationId,
      });
      await update({ activeOrganizationId: result.activeOrganizationId });
      await utils.organization.listMemberships.invalidate();
      router.refresh();
    } catch {
      setSwitchError(true);
    }
  }

  if (status === "loading" || membershipsQuery.isLoading) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="rounded-[var(--radius-control)]"
      >
        Memuat organisasi…
      </Button>
    );
  }

  if (membershipsQuery.isError) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span role="alert">Organisasi tidak dapat dimuat.</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => void membershipsQuery.refetch()}
        >
          Coba lagi
        </Button>
      </div>
    );
  }

  const memberships = membershipsQuery.data ?? [];
  if (memberships.length < 2 || !session?.user) {
    return null;
  }

  const activeOrganizationId = session.user.activeOrganizationId;
  const activeMembership = memberships.find(
    (membership) => membership.organizationId === activeOrganizationId,
  );
  const activeOrganizationName =
    activeMembership?.organization.name ?? "Pilih organisasi";

  return (
    <div className="flex items-center gap-2">
      <MenuRoot>
        <MenuTrigger
          aria-label={`Ganti organisasi. Organisasi aktif: ${activeOrganizationName}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "min-w-48 justify-between rounded-[var(--radius-control)]",
          )}
        >
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="max-w-36 truncate">{activeOrganizationName}</span>
            <span className="text-muted-foreground text-xs font-normal">
              {activeMembership?.role ?? "—"}
            </span>
          </span>
          <ChevronsUpDownIcon data-icon="inline-end" aria-hidden="true" />
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner sideOffset={6}>
            <MenuPopup>
              {memberships.map((membership) => {
                const isActive =
                  membership.organizationId === activeOrganizationId;

                return (
                  <MenuItem
                    key={membership.id}
                    disabled={switchOrganizationMutation.isPending}
                    className={cn(isActive && "bg-muted")}
                    onClick={() =>
                      void selectOrganization(membership.organizationId)
                    }
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="max-w-56 truncate">
                        {membership.organization.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {membership.role}
                      </span>
                    </span>
                    {isActive && <CheckIcon aria-hidden="true" />}
                  </MenuItem>
                );
              })}
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </MenuRoot>

      <div aria-live="polite" className="sr-only">
        {switchOrganizationMutation.isPending && "Mengganti organisasi…"}
      </div>

      {switchError && (
        <div
          role="alert"
          className="text-destructive flex items-center gap-2 text-sm"
        >
          <span>Organisasi belum bisa diganti.</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="text-destructive"
            onClick={() =>
              lastRequestedOrganizationId &&
              void selectOrganization(lastRequestedOrganizationId)
            }
          >
            Coba lagi
          </Button>
        </div>
      )}
    </div>
  );
}
