"use client";

import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useOpenNewClipping } from "@/components/clippings/new-clipping-dialog.tsx";
import { characterShortcutsOn } from "@/lib/keyboard/preference.ts";
import {
  isClippingPath,
  matchShortcut,
  type PendingSequence,
  type ShortcutAction,
} from "@/lib/keyboard/shortcuts.ts";

import { toggleTheme } from "./appearance.ts";
import { ShortcutsSheet } from "./shortcuts-sheet.tsx";

/** The home page's search field (`ClippingsBrowser`). */
const SEARCH_INPUT_ID = "clippings-search";

/** Input types that take text; a checkbox or a switch leaves the keys to the app. */
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const EDITABLE =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="textbox"], [role="searchbox"]';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(EDITABLE)) return true;
  const input = target.closest("input");
  return input !== null && !NON_TEXT_INPUTS.has(input.type);
}

/**
 * A dialog, menu or popup list is open: it owns the keyboard until it closes. A toast is an
 * `alertdialog` too, but not a modal one (`aria-modal="false"`), so it doesn't count.
 */
const OVERLAYS =
  '[role="dialog"], [role="alertdialog"]:not([aria-modal="false"]), [role="menu"], [role="listbox"]';

/**
 * App-wide keyboard shortcuts and the "?" sheet that lists them. One `keydown` listener on the
 * document, in the capture phase so that Esc is read before a dialog's own handler closes it:
 * `matchShortcut` decides, and this runs what it chose.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const openNewClipping = useOpenNewClipping();
  const [sheetOpen, setSheetOpen] = useState(false);
  const pending = useRef<PendingSequence | null>(null);

  // The page before this one, to tell whether Esc on a clipping can go back to the list.
  const trail = useRef({ current: pathname, previous: null as string | null });
  useEffect(() => {
    if (trail.current.current === pathname) return;
    trail.current = { current: pathname, previous: trail.current.current };
  }, [pathname]);

  const run = useEffectEvent((action: ShortcutAction) => {
    switch (action.type) {
      case "show-shortcuts":
        setSheetOpen(true);
        break;
      case "focus-search":
        if (pathname === "/") document.getElementById(SEARCH_INPUT_ID)?.focus();
        else router.push("/?search" as Route);
        break;
      case "new-clipping":
        openNewClipping();
        break;
      case "go-to":
        if (pathname !== action.path) router.push(action.path as Route);
        break;
      case "toggle-appearance":
        toggleTheme();
        break;
      case "leave-clipping":
        if (trail.current.previous === "/") router.back();
        else router.push("/");
        break;
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const result = matchShortcut(
        {
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          repeat: event.repeat,
          isComposing: event.isComposing,
          targetIsEditable: isEditable(event.target),
          overlayOpen: document.querySelector(OVERLAYS) !== null,
          onClipping: isClippingPath(window.location.pathname),
          characterKeys: characterShortcutsOn(),
        },
        pending.current,
        event.timeStamp,
      );
      pending.current = result.pending;
      if (!result.action) return;
      event.preventDefault();
      run(result.action);
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  return <ShortcutsSheet isOpen={sheetOpen} onOpenChange={setSheetOpen} />;
}
