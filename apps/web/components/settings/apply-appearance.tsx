"use client";

import { useEffect } from "react";

import type { Appearance } from "@clippings/shared";
import { applyAppearance } from "@clippings/ui";

/**
 * Brings this device in line with the settings saved on the server, for a change made on another
 * device while this one stayed signed in. Sign-in hands them over before first paint instead.
 */
export function ApplyAppearance({ theme, palette, contrast, density }: Appearance) {
  useEffect(() => {
    applyAppearance({ theme, palette, contrast, density });
  }, [theme, palette, contrast, density]);
  return null;
}
