"use client";

import { useEffect } from "react";

import { sharePaletteWithExtension } from "@/lib/extension/share-palette.ts";
import type { Appearance } from "@clippings/shared";
import { applyAppearance } from "@clippings/ui";

/**
 * Brings this device in line with the settings saved on the server, for a change made on another
 * device while this one stayed signed in. Sign-in hands them over before first paint instead. The
 * extension, when installed, is told the palette too.
 */
export function ApplyAppearance({ theme, palette, contrast, density }: Appearance) {
  useEffect(() => {
    applyAppearance({ theme, palette, contrast, density });
  }, [theme, palette, contrast, density]);
  useEffect(() => sharePaletteWithExtension(palette), [palette]);
  return null;
}
