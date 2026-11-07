"use client";

import { useRef } from "react";
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
export function Tabs({ className, onSelectionChange, ...props }: TabsProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <AriaTabs
      {...props}
      ref={ref}
      onSelectionChange={(key) => {
        // Before React commits the new panel, the DOM still marks the old tab: compare the two
        // tabs' places so the panels slide the way the selection moved (see `tab-panel`).
        const root = ref.current;
        if (root) {
          const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
          const from = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
          const to = tabs.findIndex((tab) => tab.dataset.key === String(key));
          if (from !== -1 && to !== -1 && from !== to) {
            root.dataset.direction = to > from ? "forward" : "backward";
          }
        }
        onSelectionChange?.(key);
      }}
      className={cn("flex flex-col", className)}
    />
  );
}

export interface TabListProps<T extends object> extends Omit<AriaTabListProps<T>, "className"> {}

export function TabList<T extends object>(props: TabListProps<T>) {
  // On a phone the tabs may not fit: the row scrolls sideways instead of widening the page.
  return (
    <AriaTabList
      {...props}
      className="flex scroll-none gap-1 overflow-x-auto overscroll-x-contain border-b border-line"
    />
  );
}

export interface TabProps extends Omit<AriaTabProps, "className" | "children"> {
  children: React.ReactNode;
}

/** The underline slides to the selected tab; the label color fades in, and out faster. */
export function Tab({ children, ...props }: TabProps) {
  return (
    <AriaTab
      {...props}
      className="flex min-h-11 flex-1 shrink-0 cursor-default items-stretch justify-center px-3 typescale-label-lg text-ink-muted transition-colors duration-quick ease-exit data-disabled:opacity-40 data-hovered:text-ink data-selected:text-ink data-selected:duration-base data-selected:ease-settle medium:min-h-10"
    >
      <div className="relative flex items-center">
        {children}
        <SelectionIndicator className="absolute start-0 bottom-0 h-0.5 w-full tab-indicator rounded-full bg-accent" />
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
