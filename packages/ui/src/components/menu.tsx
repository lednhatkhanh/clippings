"use client";

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

import type { IconName } from "../icons/icon-names.ts";
import { Icon } from "../icons/icon.tsx";

// Material's menu: a container on surface-container, 112 to 280px wide, 48px items.
const POPOVER =
  "min-w-28 max-w-70 menu-pop overflow-y-auto rounded-xs bg-surface-container shadow-2 forced-colors:border forced-colors:border-solid";

/**
 * A button and the menu it opens: pass the trigger, then the `Menu`. The menu scales up from the
 * side it is anchored on; under reduced motion it only fades.
 */
export function MenuTrigger({ children, ...props }: MenuTriggerProps) {
  const [trigger, menu] = Children.toArray(children) as [ReactElement, ReactElement];
  return (
    <AriaMenuTrigger {...props}>
      {trigger}
      <Popover placement="bottom end" offset={4} className={POPOVER}>
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
      <Popover offset={-4} className={POPOVER}>
        {menu}
      </Popover>
    </AriaSubmenuTrigger>
  );
}

export type MenuProps<T> = Omit<AriaMenuProps<T>, "className">;

export function Menu<T extends object>(props: MenuProps<T>) {
  return <AriaMenu {...props} className="flex flex-col py-2 outline-none" />;
}

export interface MenuItemProps<T> extends Omit<AriaMenuItemProps<T>, "className" | "children"> {
  /** The leading icon. A checked item in a selection menu shows a check instead. */
  icon?: IconName;
  /** Drawn before the label, such as a color dot. */
  leading?: ReactNode;
  children: string;
}

export function MenuItem<T extends object>({
  icon,
  leading,
  children,
  ...props
}: MenuItemProps<T>) {
  return (
    <AriaMenuItem
      {...props}
      textValue={props.textValue ?? children}
      className="state-layer flex min-h-12 cursor-default items-center gap-3 px-3 typescale-label-lg text-on-surface outline-none data-disabled:opacity-38 data-focused:bg-surface-container-highest forced-colors:data-focused:outline-solid"
    >
      {({ hasSubmenu, isSelected, selectionMode }) => (
        <>
          {selectionMode === "none" ? (
            icon ? (
              <Icon name={icon} className="text-xl text-on-surface-variant" />
            ) : null
          ) : (
            <Icon
              name="check"
              className={isSelected ? "text-xl text-on-surface-variant" : "invisible text-xl"}
            />
          )}
          {leading}
          <span className="min-w-0 flex-1 truncate">{children}</span>
          {hasSubmenu ? (
            <Icon
              name="chevron_right"
              className="text-xl text-on-surface-variant rtl:-scale-x-100"
            />
          ) : null}
        </>
      )}
    </AriaMenuItem>
  );
}

export function MenuSeparator() {
  return <Separator className="my-2 border-t border-outline-variant" />;
}
