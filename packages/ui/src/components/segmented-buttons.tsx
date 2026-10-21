"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SelectionIndicator, ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { cn } from "../cn.ts";

export interface SegmentedButtonsProps {
  /** The `id` of the selected `Segment`. */
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  "aria-label": string;
  /** Two to five `Segment`s. */
  children: ReactNode;
  isDisabled?: boolean;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/**
 * Segmented buttons with a single, always-present selection: a well, and a paper chip that
 * slides to the selected segment.
 */
export function SegmentedButtons({
  selectedKey,
  onSelectionChange,
  className,
  children,
  ...props
}: SegmentedButtonsProps) {
  return (
    <ToggleButtonGroup
      {...props}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[selectedKey]}
      onSelectionChange={(keys) => {
        const [key] = keys;
        if (typeof key === "string") onSelectionChange(key);
      }}
      className={cn("flex w-full gap-0.5 rounded-md bg-ground-sunk p-0.75 shadow-well", className)}
    >
      {children}
    </ToggleButtonGroup>
  );
}

export interface SegmentProps {
  /** The key `SegmentedButtons` selects by. */
  id: string;
  children: ReactNode;
  /** A leading icon, such as `icon={Sun}`. */
  icon?: LucideIcon;
  isDisabled?: boolean;
}

export function Segment({ children, icon: IconComponent, ...props }: SegmentProps) {
  return (
    <ToggleButton
      {...props}
      className="relative isolate flex h-10 min-w-0 flex-auto items-center justify-center gap-2 rounded-sm px-3 typescale-label-lg text-ink-muted transition-colors data-disabled:opacity-40 data-focus-visible:z-10 data-hovered:text-ink data-selected:text-ink medium:h-8.5"
    >
      <SelectionIndicator className="absolute inset-0 -z-10 segment-indicator rounded-sm paper" />
      {IconComponent ? <IconComponent className="size-4" /> : null}
      <span className="truncate">{children}</span>
    </ToggleButton>
  );
}
