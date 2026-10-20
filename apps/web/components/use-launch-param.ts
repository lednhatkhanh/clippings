import { useEffect, useEffectEvent } from "react";

/**
 * Changes the address without a navigation, so a reload or a shared link doesn't repeat what the
 * old one did. Next.js syncs its router with a native replaceState, so this needs no server round
 * trip; it skips that sync when handed its own history state, so this passes none.
 */
export function replaceAddress(url: URL | string) {
  window.history.replaceState(null, "", url);
}

/**
 * Runs `onLaunch` when the page opened with `?name` in its URL, as the manifest's shortcuts open
 * it, then drops the parameter so a reload or a shared link doesn't do it again.
 */
export function useLaunchParam(name: string, onLaunch: () => void) {
  const launch = useEffectEvent(onLaunch);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    replaceAddress(url);
    launch();
  }, [name]);
}
