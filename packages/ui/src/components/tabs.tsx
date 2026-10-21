"use client";

import {
  SelectionIndicator,
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  TabPanels as AriaTabPanels,
  Tabs as AriaTabs,
} from "react-aria-components";
import type {
  TabListProps as AriaTabListProps,
  TabPanelProps as AriaTabPanelProps,
  TabPanelsProps as AriaTabPanelsProps,
  TabProps as AriaTabProps,
  TabsProps as AriaTabsProps,
} from "react-aria-components";

import { cn } from "../cn.ts";

export interface TabsProps extends Omit<AriaTabsProps, "className"> {
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/**
 * Tabs: `Tabs` holds a `TabList` of `Tab`s and a `TabPanels` with one `TabPanel` per tab `id`.
 */
export function Tabs({ className, ...props }: TabsProps) {
  return <AriaTabs {...props} className={cn("flex flex-col", className)} />;
}

export interface TabListProps<T extends object> extends Omit<AriaTabListProps<T>, "className"> {}

export function TabList<T extends object>(props: TabListProps<T>) {
  return <AriaTabList {...props} className="flex gap-1 border-b border-line" />;
}

export interface TabProps extends Omit<AriaTabProps, "className" | "children"> {
  children: React.ReactNode;
}

/** The underline slides to the selected tab; the label color fades in, and out faster. */
export function Tab({ children, ...props }: TabProps) {
  return (
    <AriaTab
      {...props}
      className="flex min-h-11 flex-1 cursor-default items-stretch justify-center px-3 typescale-label-lg text-ink-muted transition-colors duration-quick ease-exit data-disabled:opacity-40 data-hovered:text-ink data-selected:text-ink data-selected:duration-base data-selected:ease-settle medium:min-h-10"
    >
      <div className="relative flex items-center">
        {children}
        <SelectionIndicator className="absolute start-0 -bottom-px h-0.5 w-full tab-indicator rounded-full bg-accent" />
      </div>
    </AriaTab>
  );
}

export interface TabPanelsProps<T extends object> extends Omit<
  AriaTabPanelsProps<T>,
  "className"
> {}

/** Holds the `TabPanel`s and animates its height to each newly selected one. */
export function TabPanels<T extends object>(props: TabPanelsProps<T>) {
  return <AriaTabPanels {...props} className="tab-panels" />;
}

export interface TabPanelProps extends Omit<AriaTabPanelProps, "className"> {
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

export function TabPanel({ className, ...props }: TabPanelProps) {
  return <AriaTabPanel {...props} className={cn("tab-panel pt-4", className)} />;
}
