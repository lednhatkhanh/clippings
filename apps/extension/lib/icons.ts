import { DEFAULT_PALETTE } from "@clippings/shared";
import tokens from "@clippings/ui/tokens.json";

/** The toolbar's colors: the default palette's light scheme, as the web app's icon uses. */
export const COLORS = tokens.palettes[DEFAULT_PALETTE].schemes.standard.light.roles;

/**
 * The Clippings mark's simplified form for 16 and 32 px, on a 64-unit square (`apps/web/app/icon.svg`
 * has the full one): a sheet of paper with a bookmark ribbon, both in a frame turned -6° about
 * (32, 33).
 */
const SHEET = "M21 10h18l9 9v32a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z";
const RIBBON = "M24 10h11v22l-5.5-4.2L24 32z";
const TILT = (-6 * Math.PI) / 180;

/** The mark's own colors, the same in every palette: the ochre tile, cream paper, dark ribbon. */
const OCHRE_TOP = "#F5D25A";
const OCHRE = "#DCA613";
const PAPER = "#FFFDF8";
const INK = "#26221C";

/** The sizes Chrome draws the toolbar button at, on standard and high-density screens. */
const SIZES = [16, 32] as const;

export type IconImages = Record<(typeof SIZES)[number], ImageData>;

/** What a state of the mark is painted with. */
interface Look {
  /** The tile's gradient, top and bottom. */
  tile: readonly [string, string];
  ribbon: string;
}

/** The mark at each size. The service worker has no DOM, but has canvases. */
function draw({ tile, ribbon }: Look): IconImages {
  const images = {} as IconImages;
  for (const size of SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas in the service worker");
    context.scale(size / 64, size / 64);
    const gradient = context.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, tile[0]);
    gradient.addColorStop(1, tile[1]);
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(0, 0, 64, 64, 14);
    context.fill();
    context.translate(32, 33);
    context.rotate(TILT);
    context.translate(-32, -33);
    context.fillStyle = PAPER;
    context.fill(new Path2D(SHEET));
    context.fillStyle = ribbon;
    context.fill(new Path2D(RIBBON));
    images[size] = context.getImageData(0, 0, size, size);
  }
  return images;
}

let drawn: { unsaved: IconImages; saved: IconImages } | undefined;

/**
 * The toolbar icons: the mark as the web app shows it for a page not saved, and for a saved one
 * turned over: a dark tile with the ribbon in ochre, which reads as filled in at 16 px on a light
 * or a dark toolbar. Drawn once per service-worker start.
 */
export function toolbarIcons() {
  drawn ??= {
    unsaved: draw({ tile: [OCHRE_TOP, OCHRE], ribbon: INK }),
    saved: draw({ tile: [INK, INK], ribbon: OCHRE_TOP }),
  };
  return drawn;
}
