"use client";

import { Check, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Children, type ReactElement, type ReactNode } from "react";
import {
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger as AriaMenuTrigger,
  SubmenuTrigger as AriaSubmenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import type {
  MenuItemProps as AriaMenuItemProps,
  MenuProps as AriaMenuProps,
  MenuTriggerProps,
  SubmenuTriggerProps,
} from "react-aria-components";

import { cn } from "../cn.ts";

// Float glass, 44 to 288px wide, with 6px of padding around its 38px items.
const POPOVER =
  "min-w-44 max-w-72 menu-pop glass-float scroll-thin overflow-y-auto rounded-lg-increased p-1.5 text-ink";

/**
 * A button and the menu it opens: pass the trigger, then the `Menu`. The menu grows from the side
 * it is anchored on; under reduced motion it only fades.
 */
export function MenuTrigger({ children, ...props }: MenuTriggerProps) {
  const [trigger, menu] = Children.toArray(children) as [ReactElement, ReactElement];
  return (
    <AriaMenuTrigger {...props}>
      {trigger}
      <Popover placement="bottom end" offset={6} className={POPOVER}>
        {menu}
      </Popover>
    </AriaMenuTrigger>
  );
}

/** A menu item that opens a menu of its own: pass the `MenuItem`, then the `Menu`. */
export function SubmenuTrigger({ children, ...props }: SubmenuTriggerProps) {
  const [trigger, menu] = Children.toArray(children) as [ReactElement, ReactElement];
  return (
    <AriaSubmenuTrigger {...props}>
      {trigger}
      <Popover offset={-6} className={POPOVER}>
        {menu}
      </Popover>
    </AriaSubmenuTrigger>
  );
}

export type MenuProps<T> = Omit<AriaMenuProps<T>, "className">;

export function Menu<T extends object>(props: MenuProps<T>) {
  return <AriaMenu {...props} className="flex flex-col outline-none" />;
}

export interface MenuItemProps<T> extends Omit<AriaMenuItemProps<T>, "className" | "children"> {
  /** The leading icon, such as `icon={Pencil}`. A checked item in a selection menu shows a check instead. */
  icon?: LucideIcon;
  /** Drawn before the label, such as a color dot. */
  leading?: ReactNode;
  /** Marks a destructive item, such as Delete: its text and icon turn to the danger color. */
  isDanger?: boolean;
  children: string;
}

export function MenuItem<T extends object>({
  icon: IconComponent,
  leading,
  isDanger = false,
  children,
  ...props
}: MenuItemProps<T>) {
  return (
    <AriaMenuItem
      {...props}
      textValue={props.textValue ?? children}
      className={cn(
        "flex min-h-11 cursor-default items-center gap-2.5 rounded-md px-2.5 typescale-label-lg transition-colors outline-none data-disabled:opacity-40 data-focused:bg-line data-pressed:bg-line-strong medium:min-h-9.5 forced-colors:data-focused:outline-solid",
        isDanger ? "text-danger" : "text-ink",
      )}
    >
      {({ hasSubmenu, isSelected, selectionMode }) => (
        <>
          {selectionMode === "none" ? (
            IconComponent ? (
              <IconComponent className={cn("size-4.5", isDanger ? null : "text-ink-muted")} />
            ) : null
          ) : (
            <Check className={cn("size-4.5 text-ink-muted", isSelected ? null : "invisible")} />
          )}
          {leading}
          <span className="min-w-0 flex-1 truncate">{children}</span>
          {hasSubmenu ? (
            <ChevronRight className="size-4.5 text-ink-muted rtl:-scale-x-100" />
          ) : null}
        </>
      )}
    </AriaMenuItem>
  );
}

export function MenuSeparator() {
  return <Separator className="mx-1 my-1.5 h-px bg-line" />;
}
