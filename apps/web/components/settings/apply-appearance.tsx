"use client";

import { useEffect } from "react";

import { sharePaletteWithExtension } from "@/lib/extension/share-palette.ts";
import { isAppearanceValue, type Appearance } from "@clippings/shared";
import { applyAppearance } from "@clippings/ui";

/**
 * Brings this device in line with the settings saved on the server, for a change made on another
 * device while this one stayed signed in. Sign-in hands them over before first paint instead.
 *
 * The extension, when installed, is told the palette too: the one shown now, and each one the
 * user picks after, in Settings or the command palette. Both paint it on `<html>`, so watching
 * that attribute catches every change, a failed save's revert included.
 */
export function ApplyAppearance({
  appearance: { theme, palette, contrast, density },
  extensionIds,
}: {
  appearance: Appearance;
  /** The extension ids the app trusts: the pinned one and any store listing's. */
  extensionIds: readonly string[];
}) {
  useEffect(() => {
    applyAppearance({ theme, palette, contrast, density });
  }, [theme, palette, contrast, density]);

  const ids = extensionIds.join(" ");
  useEffect(() => {
    const root = document.documentElement;
    const share = () => {
      const shown = root.getAttribute("data-palette");
      if (isAppearanceValue("palette", shown)) sharePaletteWithExtension(shown, ids.split(" "));
    };
    share();
    const observer = new MutationObserver(share);
    observer.observe(root, { attributes: true, attributeFilter: ["data-palette"] });
    return () => observer.disconnect();
  }, [ids]);
  return null;
}
