"use client";

import { Bookmark, MessageCircleQuestion, Plus, Search, Settings2, Tag } from "lucide-react";
import { Button } from "react-aria-components";

import { cn } from "@clippings/ui";

import { useOpenNewClipping } from "./clippings/new-clipping-dialog.tsx";
import { openCommandPalette } from "./command/command-palette.tsx";
import { NavLink } from "./nav-link.tsx";
import { useOnline } from "./online-status.tsx";

const RAIL_BUTTON =
  "state-layer flex cursor-default items-center justify-center rounded-lg typescale-label-lg outline-offset-2 transition-colors";

/**
 * The navigation, from one `<nav>` of glass that floats clear of the edges:
 * - compact (< 600px): a bar above the bottom edge, each destination an icon in a pill and a label;
 * - medium and expanded (600–1199px): a collapsed rail, 72px wide, icons only;
 * - large and up (≥ 1200px): an expanded rail, 240px wide, with the brand, "New clipping" and
 *   "Jump to…".
 * It is named, so page transitions run beneath it without moving it.
 */
export function AppNav() {
  const openNewClipping = useOpenNewClipping();
  const online = useOnline();

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 pb-safe medium:inset-y-0 medium:end-auto medium:w-24 medium:p-3 large:w-66 print:hidden">
      <nav
        aria-label="Main"
        className="pointer-events-auto mx-3 mb-3 flex h-17 rounded-xl glass p-1 vt-anchored-nav medium:m-0 medium:h-full medium:flex-col medium:items-center medium:gap-4 medium:px-0 medium:py-3 large:items-stretch large:gap-5 large:px-3 large:pt-5"
      >
        <div className="hidden items-center gap-2.5 px-1 medium:flex large:px-2">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-md accent-fill large:size-8"
          >
            <Bookmark className="size-5 large:size-4.5" />
          </span>
          <span className="hidden typescale-title-lg tracking-tight large:inline">Clippings</span>
        </div>

        <Button
          isDisabled={!online}
          onPress={() => openNewClipping()}
          className={cn(
            RAIL_BUTTON,
            "hidden size-12 shrink-0 gap-2 accent-fill data-disabled:opacity-40 medium:flex large:h-11 large:w-full large:rounded-lg",
          )}
        >
          <Plus className="size-5" />
          <span className="sr-only large:not-sr-only">New clipping</span>
        </Button>

        <ul className="flex flex-1 medium:flex-none medium:flex-col medium:gap-1 large:w-full">
          <li className="flex flex-1 medium:flex-none large:w-full">
            <NavLink href="/" icon={Bookmark} label="Clippings" />
          </li>
          <li className="flex flex-1 medium:flex-none large:w-full">
            <NavLink href="/ask" icon={MessageCircleQuestion} label="Ask" />
          </li>
          <li className="flex flex-1 medium:flex-none large:w-full">
            <NavLink href="/tags" icon={Tag} label="Tags" />
          </li>
          <li className="flex flex-1 medium:flex-none large:w-full">
            <NavLink href="/settings" icon={Settings2} label="Settings" />
          </li>
        </ul>

        <Button
          onPress={openCommandPalette}
          aria-keyshortcuts="Meta+K Control+K"
          className={cn(
            RAIL_BUTTON,
            "hidden size-12 shrink-0 gap-3 text-ink-muted data-hovered:text-ink medium:mt-auto medium:flex large:h-11 large:w-full large:justify-start large:px-3.5",
          )}
        >
          <Search className="size-5" />
          <span className="sr-only large:not-sr-only large:flex-1 large:text-start">Jump to…</span>
          <kbd
            aria-hidden="true"
            className="hidden h-5.5 items-center rounded-sm bg-ground-sunk px-1.5 typescale-label-sm font-mono text-ink-muted large:flex"
          >
            ⌘K
          </kbd>
        </Button>
      </nav>
    </div>
  );
}
