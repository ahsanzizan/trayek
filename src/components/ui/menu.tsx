import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "~/lib/utils";

const MenuRoot = MenuPrimitive.Root;
const MenuPortal = MenuPrimitive.Portal;
const MenuPositioner = MenuPrimitive.Positioner;

function MenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return (
    <MenuPrimitive.Trigger
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

function MenuPopup({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup>) {
  return (
    <MenuPrimitive.Popup
      className={cn(
        "border-border-strong bg-surface-raised text-foreground z-50 min-w-48 rounded-[var(--radius-control)] border p-1 text-sm shadow-lg outline-none",
        className,
      )}
      {...props}
    />
  );
}

function MenuItem({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "data-[highlighted]:bg-muted flex cursor-default items-center justify-between gap-3 rounded-[calc(var(--radius-control)-2px)] px-3 py-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export {
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRoot,
  MenuTrigger,
};
