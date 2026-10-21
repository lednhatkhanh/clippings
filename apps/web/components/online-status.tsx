"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the browser has a network, as it reports it. The server and the first render assume
 * online, so nothing is disabled until the browser says otherwise.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Says that saving, editing and deleting are paused while offline; what has loaded stays.
 * The <output> is a polite live region and always there, so the banner is announced when it
 * appears. The pill floats clear of the navigation: under the header on a phone, along the bottom
 * edge from medium.
 */
export function OfflineBanner() {
  const online = useOnline();

  return (
    <output className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-3 medium:top-auto medium:bottom-6 medium:ps-25 medium:pe-3 large:ps-69 print:hidden">
      {online ? null : (
        <span className="flex items-center gap-2 rounded-full glass-float py-2.5 ps-3.5 pe-4 typescale-body-md text-ink">
          <WifiOff className="size-4.5 text-ink-muted" />
          You&apos;re offline. Changes are paused.
        </span>
      )}
    </output>
  );
}
