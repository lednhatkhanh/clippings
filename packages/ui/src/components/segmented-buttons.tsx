"use client";

import type { ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { cn } from "../cn.ts";
import { Icon } from "../icons/icon.tsx";

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

/** M3 outlined segmented buttons with a single, always-present selection. */
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
      className={cn("flex w-full", className)}
    >
      {children}
    </ToggleButtonGroup>
  );
}

export interface SegmentProps {
  /** The key `SegmentedButtons` selects by. */
  id: string;
  children: ReactNode;
  isDisabled?: boolean;
}

export function Segment({ children, ...props }: SegmentProps) {
  return (
    <ToggleButton
      {...props}
      className="state-layer flex h-10 min-w-0 flex-1 items-center justify-center gap-2 border border-outline px-3 typescale-label-lg text-on-surface transition-colors not-first:-ms-px first:rounded-s-full last:rounded-e-full data-disabled:opacity-38 data-focus-visible:z-10 data-selected:bg-secondary-container data-selected:text-on-secondary-container"
    >
      {({ isSelected }) => (
        <>
          {isSelected && (
            <span className="flex check-pop">
              <Icon name="check" className="text-lg" />
            </span>
          )}
          <span className="truncate">{children}</span>
        </>
      )}
    </ToggleButton>
  );
}
