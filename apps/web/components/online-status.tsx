"use client";

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
 * appears.
 */
export function OfflineBanner() {
  const online = useOnline();

  return (
    <output className="sticky top-16 z-20 block print:hidden">
      {online ? null : (
        <p className="bg-inverse-surface px-4 py-3 typescale-body-md text-inverse-on-surface medium:px-6 large:px-8">
          You&apos;re offline. Changes are paused.
        </p>
      )}
    </output>
  );
}
