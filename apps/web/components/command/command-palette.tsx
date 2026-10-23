"use client";

import { lazy, Suspense, useEffect, useState } from "react";

import { useOpenNewClipping } from "@/components/clippings/new-clipping-dialog.tsx";
import { whenIdle } from "@/components/when-idle.ts";

// The palette's body (modal, menu, icons, tags) is its own chunk: fetched once the page is idle,
// so ⌘K opens it at once, without weighing on every page's first load.
const loadPaletteModal = () => import("./command-palette-modal.tsx");
const PaletteModal = lazy(async () => ({ default: (await loadPaletteModal()).PaletteModal }));

/** ⌘K or Ctrl+K, without Shift or Alt, which other shortcuts use. */
const isPaletteShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "k" &&
  (event.metaKey || event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey;

/** Fired on `document` to open the palette from a button, such as the rail's "Jump to…". */
const OPEN_EVENT = "clippings:open-command-palette";

/** Opens the command palette, as ⌘K does. Does nothing until a `CommandPalette` is mounted. */
export function openCommandPalette() {
  document.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/**
 * ⌘K (Ctrl+K) from anywhere in the app opens a palette of commands: New clipping, go to a tag,
 * and switch mode or palette. On a clipping's page it also pins, shares and copies the link of
 * that clipping. Esc, or the shortcut again, closes it. `openCommandPalette()` opens
 * it from a button.
 */
export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  // Once opened, the body stays mounted so closing can animate out.
  const [wasOpened, setWasOpened] = useState(false);
  const openNewClipping = useOpenNewClipping();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      setWasOpened(true);
      setIsOpen((open) => !open);
    };
    const onOpen = () => {
      setWasOpened(true);
      setIsOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener(OPEN_EVENT, onOpen);
    // Warm the chunk, so the first open doesn't wait for it.
    const cancelWarm = whenIdle(() => void loadPaletteModal());
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener(OPEN_EVENT, onOpen);
      cancelWarm();
    };
  }, []);

  if (!wasOpened) return null;
  return (
    <Suspense fallback={null}>
      <PaletteModal isOpen={isOpen} onOpenChange={setIsOpen} onNewClipping={openNewClipping} />
    </Suspense>
  );
}
