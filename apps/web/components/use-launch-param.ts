import { useEffect, useEffectEvent } from "react";

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
    // Next.js syncs its router with a native replaceState, so this needs no server round trip.
    window.history.replaceState(window.history.state, "", url);
    launch();
  }, [name]);
}
