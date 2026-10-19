"use client";

import { useEffect } from "react";

import { SKIP_WAITING } from "@/lib/pwa/service-worker.ts";
import { toasts } from "@clippings/ui";

/**
 * Registers `/sw.js` in production builds, so `next dev` and HMR never go through a cache. A new
 * version waits: the toast's Reload hands it control and reloads once it has it, so a deploy
 * never reloads an open note edit on its own.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const { serviceWorker } = navigator;
    let toastKey: string | undefined;
    let reloading = false;

    const offerUpdate = (worker: ServiceWorker) => {
      // The first install has nothing to replace.
      if (toastKey || !serviceWorker.controller) return;
      toastKey = toasts.show(
        {
          message: "A new version is available",
          action: {
            label: "Reload",
            onAction: () => {
              reloading = true;
              worker.postMessage({ type: SKIP_WAITING });
            },
          },
        },
        { persistent: true },
      );
    };

    const onControllerChange = () => {
      if (reloading) window.location.reload();
    };
    serviceWorker.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | undefined;
    // Browsers check for a new worker on full navigations; an app left open checks on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    document.addEventListener("visibilitychange", onVisible);

    void serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registered) => {
        registration = registered;
        if (registered.waiting) offerUpdate(registered.waiting);
        registered.addEventListener("updatefound", () => {
          const installing = registered.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed") offerUpdate(installing);
          });
        });
      })
      .catch(() => {
        // Without a worker the app still works online; there is nothing to tell the user.
      });

    return () => {
      serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
