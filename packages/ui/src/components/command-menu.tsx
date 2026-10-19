"use client";

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

import type { IconName } from "../icons/icon-names.ts";
import { Icon } from "../icons/icon.tsx";

export interface CommandMenuProps {
  /** The search field's accessible name; the placeholder is what shows. */
  "aria-label": string;
  placeholder?: string;
  /** Shown when the search matches no command. */
  emptyMessage?: string;
  children: ReactNode;
}

/**
 * A search field that filters the commands under it, for a command palette: put it in a `Dialog`.
 * Focus stays in the field while the arrow keys move through the commands and Enter runs one. A
 * text field, not a search field, so Esc closes the palette at once instead of clearing the text.
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
        className="flex h-14 items-center gap-3 rounded-full bg-surface-container-highest ps-4 pe-4 text-on-surface outline-0 outline-primary outline-solid focus-within:outline-2 forced-colors:border forced-colors:border-solid"
      >
        <Icon name="search" className="shrink-0 text-2xl text-on-surface-variant" />
        <Input
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent typescale-body-lg outline-none placeholder:text-on-surface-variant"
        />
      </TextField>
      <Menu
        aria-label={label}
        className="-mx-2 flex max-h-96 flex-col gap-2 overflow-y-auto px-2 outline-none"
        renderEmptyState={() => (
          <p className="px-3 py-4 typescale-body-md text-on-surface-variant">{emptyMessage}</p>
        )}
      >
        {children}
      </Menu>
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
    <MenuSection className="flex flex-col">
      <Header className="px-3 pt-2 pb-1 typescale-label-md text-on-surface-variant">{title}</Header>
      {children}
    </MenuSection>
  );
}

export interface CommandProps extends Omit<MenuItemProps, "className" | "children" | "style"> {
  /** What the command does; the search matches it. */
  children: string;
  icon?: IconName;
  /** Marks the command as the current choice, such as the palette in use. */
  isCurrent?: boolean;
}

/** One command: runs `onAction`, or follows `href`, and the palette closes. */
export function Command({ children, icon, isCurrent = false, ...props }: CommandProps) {
  return (
    <MenuItem
      {...props}
      textValue={props.textValue ?? children}
      className="state-layer flex min-h-12 cursor-default items-center gap-3 rounded-md px-3 typescale-body-lg text-on-surface outline-none data-focused:bg-secondary-container data-focused:text-on-secondary-container"
    >
      {icon ? <Icon name={icon} className="shrink-0 text-2xl" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {isCurrent ? (
        <>
          <Icon name="check" className="shrink-0 text-2xl" />
          <span className="sr-only">(current)</span>
        </>
      ) : null}
    </MenuItem>
  );
}
