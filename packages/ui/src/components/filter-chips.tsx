"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { cn } from "../cn.ts";

export interface FilterChipsProps {
  /** The `id`s of the selected `FilterChip`s; none selected means no filter. */
  selectedKeys: readonly string[];
  onSelectionChange: (keys: string[]) => void;
  "aria-label": string;
  children: ReactNode;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** A row of filter chips, any number of them selected. */
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
      className="state-layer flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 typescale-label-lg text-ink-muted transition-colors data-selected:border-transparent data-selected:bg-accent-soft data-selected:text-on-accent-soft forced-colors:data-selected:border-solid"
    >
      {({ isSelected }) => (
        <>
          {isSelected && <Check className="size-4" />}
          {children}
        </>
      )}
    </ToggleButton>
  );
}
