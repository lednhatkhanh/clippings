import { transitionAppearance } from "@clippings/ui";

import { followStoredPalette, paintMirroredPalette } from "./palette.ts";

/**
 * Puts an extension page in the user's palette: the mirrored one at once, before React renders,
 * then any newer one with a crossfade. Light or dark follows the OS.
 */
export function paintPalette(): void {
  paintMirroredPalette();
  followStoredPalette((palette) =>
    transitionAppearance(() => document.documentElement.setAttribute("data-palette", palette), {
      kind: "fade",
    }),
  );
}
