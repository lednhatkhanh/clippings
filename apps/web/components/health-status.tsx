"use client";

import { useEffect, useState } from "react";

type HealthState = "checking" | "ok" | "down";

export function HealthStatus() {
  const [state, setState] = useState<HealthState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then((response) => setState(response.ok ? "ok" : "down"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState("down");
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <output className="block typescale-body-md text-on-surface-variant">Service: {state}</output>
  );
}
