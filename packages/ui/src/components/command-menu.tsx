"use client";

import { Check, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Autocomplete,
  Header,
  Input,
  Menu,
  MenuItem,
  MenuSection,
  TextField,
  useFilter,
} from "react-aria-components";
import type { MenuItemProps } from "react-aria-components";

export interface CommandMenuProps {
  /** The search field's accessible name; the placeholder is what shows. */
  "aria-label": string;
  placeholder?: string;
  /** Shown when the search matches no command. */
  emptyMessage?: string;
  children: ReactNode;
}

const KEY =
  "inline-flex h-5.5 items-center rounded-xs bg-line px-1.5 typescale-label-sm text-ink-muted";

/**
 * A search field that filters the commands under it, for a command palette: put it in a `Dialog`
 * inside a `Modal variant="palette"`, which gives it no padding of its own. Focus stays in the
 * field while the arrow keys move through the commands and Enter runs one. A text field, not a
 * search field, so Esc closes the palette at once instead of clearing the text.
 */
export function CommandMenu({
  "aria-label": label,
  placeholder,
  emptyMessage = "No matches.",
  children,
}: CommandMenuProps) {
  const { contains } = useFilter({ sensitivity: "base" });

  return (
    <Autocomplete filter={contains}>
      <TextField
        aria-label={label}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the palette opens to type a command
        autoFocus
        className="flex h-15 items-center gap-3 border-b border-line ps-4.5 pe-4.5 text-ink-muted transition-colors outline-none focus-within:border-accent-ink"
      >
        <Search className="size-5 shrink-0" />
        <Input
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent typescale-body-lg text-ink outline-none placeholder:text-ink-faint"
        />
        <span aria-hidden="true" className={KEY}>
          esc
        </span>
      </TextField>
      <Menu
        aria-label={label}
        className="flex max-h-96 flex-col gap-0.5 overflow-y-auto p-2 outline-none"
        renderEmptyState={() => (
          <p className="px-3 py-4 typescale-body-md text-ink-muted">{emptyMessage}</p>
        )}
      >
        {children}
      </Menu>
      <div
        aria-hidden="true"
        className="flex gap-4 border-t border-line px-4.5 py-2.5 typescale-body-sm text-ink-faint"
      >
        <span className="flex items-center gap-1.5">
          <span className={KEY}>↑↓</span> move
        </span>
        <span className="flex items-center gap-1.5">
          <span className={KEY}>↵</span> run
        </span>
      </div>
    </Autocomplete>
  );
}

export interface CommandGroupProps {
  title: string;
  children: ReactNode;
}

/** Commands under a heading, such as every tag to go to. */
export function CommandGroup({ title, children }: CommandGroupProps) {
  return (
    <MenuSection className="flex flex-col gap-0.5">
      <Header className="px-3 pt-3 pb-1 typescale-label-sm tracking-wider text-ink-faint uppercase">
        {title}
      </Header>
      {children}
    </MenuSection>
  );
}

export interface CommandProps extends Omit<MenuItemProps, "className" | "children" | "style"> {
  /** What the command does; the search matches it. */
  children: string;
  icon?: LucideIcon;
  /** Marks the command as the current choice, such as the palette in use. */
  isCurrent?: boolean;
}

/** One command: runs `onAction`, or follows `href`, and the palette closes. */
export function Command({
  children,
  icon: IconComponent,
  isCurrent = false,
  ...props
}: CommandProps) {
  return (
    <MenuItem
      {...props}
      textValue={props.textValue ?? children}
      className="group flex min-h-11 cursor-default items-center gap-3 rounded-md px-3 typescale-body-lg text-ink transition-colors outline-none data-focused:bg-accent-soft data-focused:text-on-accent-soft"
    >
      {IconComponent ? (
        <IconComponent className="size-4.5 shrink-0 text-ink-muted group-data-focused:text-on-accent-soft" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {isCurrent ? (
        <>
          <Check className="size-4.5 shrink-0" />
          <span className="sr-only">(current)</span>
        </>
      ) : null}
    </MenuItem>
  );
}
