"use client";

import { useSyncExternalStore } from "react";

import { toasts } from "@clippings/ui";

import { copyLink, shareLink, type ShareEnv, type ShareLink, type ShareOutcome } from "./share.ts";

const noSubscription = () => () => {};

/**
 * Whether this browser has a share sheet. False while rendering on the server and during
 * hydration, then true on the client where `navigator.share` exists, so the markup matches.
 */
export function useCanShare(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === "function",
    () => false,
  );
}

const browser = (): ShareEnv => ({
  share: typeof navigator.share === "function" ? (link) => navigator.share(link) : undefined,
  copy: async (text) => {
    // Missing outside a secure context.
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
  },
});

function announce(outcome: ShareOutcome) {
  if (outcome === "copied") toasts.show({ message: "Link copied" });
  else if (outcome === "failed") toasts.show({ message: "Couldn't copy the link." });
}

/** Copies the original page's address and says so in a toast. Call it from a user event. */
export async function copyLinkWithToast(url: string): Promise<void> {
  announce(await copyLink(url, browser()));
}

/**
 * Opens the share sheet with the shown title and the original address; where sharing fails it
 * copies the address instead. Call it from a user event.
 */
export async function shareLinkWithToast(link: ShareLink): Promise<void> {
  announce(await shareLink(link, browser()));
}
