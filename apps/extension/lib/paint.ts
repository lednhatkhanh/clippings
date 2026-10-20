import { transitionAppearance } from "@clippings/ui";

import { followStoredPalette, paintMirroredPalette, paintStoredPalette } from "./palette.ts";

/**
 * Puts an extension page in the user's palette before React renders: the mirrored one at once,
 * then the one in sync storage, which the page awaits. A newer one after that crossfades in.
 * Light or dark follows the OS.
 */
export async function paintPalette(): Promise<void> {
  paintMirroredPalette();
  await paintStoredPalette();
  followStoredPalette((palette) =>
    transitionAppearance(() => document.documentElement.setAttribute("data-palette", palette), {
      kind: "fade",
    }),
  );
}
