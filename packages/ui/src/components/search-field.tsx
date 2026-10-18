"use client";

import { Button, Input, SearchField as AriaSearchField } from "react-aria-components";
import type { SearchFieldProps as AriaSearchFieldProps } from "react-aria-components";

import { cn } from "../cn.ts";
import { Icon } from "../icons/icon.tsx";

export interface SearchFieldProps extends Omit<AriaSearchFieldProps, "className" | "children"> {
  /** The field's accessible name; the placeholder is what shows. */
  "aria-label": string;
  placeholder?: string;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** M3 search bar: a 56px pill with a leading search icon and a clear button. Esc clears it. */
export function SearchField({ placeholder, className, ...props }: SearchFieldProps) {
  return (
    <AriaSearchField
      {...props}
      className={cn(
        "group flex h-14 items-center gap-1 rounded-full bg-surface-container-high ps-4 pe-1 text-on-surface outline-0 outline-primary outline-solid focus-within:outline-2 forced-colors:border forced-colors:border-solid",
        className,
      )}
    >
      <Icon name="search" className="shrink-0 text-2xl text-on-surface-variant" />
      <Input
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent px-2 typescale-body-lg outline-none placeholder:text-on-surface-variant [&::-webkit-search-cancel-button]:appearance-none"
      />
      <Button
        aria-label="Clear search"
        className="state-layer flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant group-data-empty:invisible"
      >
        <Icon name="close" className="text-2xl" />
      </Button>
    </AriaSearchField>
  );
}
