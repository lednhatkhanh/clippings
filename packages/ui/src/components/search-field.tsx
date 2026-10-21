"use client";

import { Search, X } from "lucide-react";
import { Button, Group, Input, SearchField as AriaSearchField } from "react-aria-components";
import type { SearchFieldProps as AriaSearchFieldProps } from "react-aria-components";

import { cn } from "../cn.ts";

export interface SearchFieldProps extends Omit<AriaSearchFieldProps, "className" | "children"> {
  /** The field's accessible name; the placeholder is what shows. */
  "aria-label": string;
  placeholder?: string;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** A 44px well with a leading search icon and a clear button. Esc clears it. */
export function SearchField({ placeholder, className, ...props }: SearchFieldProps) {
  return (
    <AriaSearchField {...props} className={cn("group", className)}>
      <Group
        role="presentation"
        className="flex h-11 items-center gap-2 rounded-lg field-indicator ps-3.5 pe-1.5 text-ink-muted group-data-disabled:opacity-40"
      >
        <Search className="size-4.5 shrink-0" />
        <Input
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent typescale-body-lg text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:appearance-none"
        />
        <Button
          aria-label="Clear search"
          className="state-layer flex size-9 shrink-0 items-center justify-center rounded-md group-data-empty:invisible"
        >
          <X className="size-4.5" />
        </Button>
      </Group>
    </AriaSearchField>
  );
}
