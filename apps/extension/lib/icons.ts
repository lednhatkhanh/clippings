import { DEFAULT_PALETTE } from "@clippings/shared";
import tokens from "@clippings/ui/tokens.json";

/** The toolbar's colors: the default palette's light scheme, as the web app's icon uses. */
export const COLORS = tokens.palettes[DEFAULT_PALETTE].schemes.standard.light.roles;

/** The Clippings mark, a paper clip bent into a "C", on a 64-unit square (`apps/web/app/icon.svg`). */
const MARK = "M46 18H27A14 14 0 0 0 27 46H43A8 8 0 0 0 43 30H30A4 4 0 0 0 30 38H40";

/** The sizes Chrome draws the toolbar button at, on standard and high-density screens. */
const SIZES = [16, 32] as const;

export type IconImages = Record<(typeof SIZES)[number], ImageData>;

/** The mark on its tile, drawn at each size. The service worker has no DOM, but has canvases. */
function draw(tile: string, clip: string): IconImages {
  const images = {} as IconImages;
  for (const size of SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas in the service worker");
    context.scale(size / 64, size / 64);
    context.fillStyle = tile;
    context.beginPath();
    context.roundRect(0, 0, 64, 64, 16);
    context.fill();
    context.strokeStyle = clip;
    // Thicker at 16 px, where 4.5 units would be a one-pixel line.
    context.lineWidth = size === 16 ? 6 : 4.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(new Path2D(MARK));
    images[size] = context.getImageData(0, 0, size, size);
  }
  return images;
}

let drawn: { unsaved: IconImages; saved: IconImages } | undefined;

/**
 * The toolbar icons: the mark as the web app shows it for a page not saved, and filled with the
 * primary color for a saved one. Drawn once per service-worker start.
 */
export function toolbarIcons() {
  drawn ??= {
    unsaved: draw(COLORS["secondary-container"], COLORS["on-secondary-container"]),
    saved: draw(COLORS.primary, COLORS["on-primary"]),
  };
  return drawn;
}
