"use client";

import type { ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { cn } from "../cn.ts";
import { Icon } from "../icons/icon.tsx";

export interface FilterChipsProps {
  /** The `id`s of the selected `FilterChip`s; none selected means no filter. */
  selectedKeys: readonly string[];
  onSelectionChange: (keys: string[]) => void;
  "aria-label": string;
  children: ReactNode;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** A row of M3 filter chips, any number of them selected. */
export function FilterChips({
  selectedKeys,
  onSelectionChange,
  className,
  children,
  ...props
}: FilterChipsProps) {
  return (
    <ToggleButtonGroup
      {...props}
      selectionMode="multiple"
      selectedKeys={selectedKeys}
      onSelectionChange={(keys) =>
        onSelectionChange([...keys].filter((key): key is string => typeof key === "string"))
      }
      className={cn("flex flex-wrap gap-2", className)}
    >
      {children}
    </ToggleButtonGroup>
  );
}

export interface FilterChipProps {
  /** The key `FilterChips` selects by. */
  id: string;
  children: ReactNode;
}

export function FilterChip({ children, ...props }: FilterChipProps) {
  return (
    <ToggleButton
      {...props}
      className="state-layer flex h-8 items-center gap-2 rounded-sm border border-outline px-4 typescale-label-lg text-on-surface-variant data-focus-visible:outline-solid data-selected:border-transparent data-selected:bg-secondary-container data-selected:ps-2 data-selected:text-on-secondary-container forced-colors:data-selected:border-solid"
    >
      {({ isSelected }) => (
        <>
          {isSelected && <Icon name="check" className="text-lg" />}
          {children}
        </>
      )}
    </ToggleButton>
  );
}
