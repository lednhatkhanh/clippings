"use client";

import { useEffect, useSyncExternalStore } from "react";

/** The clipping whose detail page is open, with what the command palette needs to act on it. */
export interface CurrentClipping {
  /** The shown title and the original address, for Share and Copy link. */
  title: string;
  url: string;
  pinned: boolean;
  /** Pins or unpins it, the same way the page's own button does. */
  togglePin: () => void;
}

let current: CurrentClipping | null = null;
const listeners = new Set<() => void>();

function set(next: CurrentClipping | null) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The open clipping's actions for the command palette; null on any other page. */
export function useCurrentClipping(): CurrentClipping | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Offers the detail page's clipping to the command palette while the page is mounted. */
export function useRegisterCurrentClipping({ title, url, pinned, togglePin }: CurrentClipping) {
  useEffect(() => {
    set({ title, url, pinned, togglePin });
  }, [title, url, pinned, togglePin]);
  useEffect(() => () => set(null), []);
}
