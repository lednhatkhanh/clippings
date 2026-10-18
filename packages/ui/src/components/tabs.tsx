"use client";

import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
} from "react-aria-components";
import type {
  TabListProps as AriaTabListProps,
  TabPanelProps as AriaTabPanelProps,
  TabProps as AriaTabProps,
  TabsProps as AriaTabsProps,
} from "react-aria-components";

import { cn } from "../cn.ts";

export interface TabsProps extends Omit<AriaTabsProps, "className"> {
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** M3 primary tabs: `Tabs` holds a `TabList` of `Tab`s and one `TabPanel` per tab `id`. */
export function Tabs({ className, ...props }: TabsProps) {
  return <AriaTabs {...props} className={cn("flex flex-col", className)} />;
}

export interface TabListProps<T extends object> extends Omit<AriaTabListProps<T>, "className"> {}

export function TabList<T extends object>(props: TabListProps<T>) {
  return <AriaTabList {...props} className="flex border-b border-outline-variant" />;
}

export interface TabProps extends Omit<AriaTabProps, "className" | "children"> {
  children: React.ReactNode;
}

export function Tab({ children, ...props }: TabProps) {
  return (
    <AriaTab
      {...props}
      className="group state-layer flex min-h-12 flex-1 cursor-default items-stretch justify-center px-4 typescale-title-sm text-on-surface-variant data-disabled:opacity-38 data-selected:text-primary"
    >
      <span className="relative flex items-center">
        {children}
        <span className="absolute inset-x-0 bottom-0 hidden rounded-t-full border-t-3 border-primary group-data-selected:block" />
      </span>
    </AriaTab>
  );
}

export interface TabPanelProps extends Omit<AriaTabPanelProps, "className"> {
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

export function TabPanel({ className, ...props }: TabPanelProps) {
  return <AriaTabPanel {...props} className={cn("pt-4", className)} />;
}
