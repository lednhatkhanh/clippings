/**
 * The Clippings mark: a sheet of paper with a bookmark ribbon, tipped 6° as if just set down, on an
 * ochre tile with a glass sheen. Drawn on a 64-unit grid. Installed icons and the favicon don't
 * follow the user's palette (the OS and browser cache them), so the tile is the brand ochre.
 *
 * Two levels of detail: `full` (folded corner, shadow, two text lines) from 48px up, `small`
 * (sheet and ribbon only) below, where the details would turn to mush.
 */
export const BRAND = {
  tileTop: "#F5D25A",
  tileBottom: "#DCA613",
  paperTop: "#FFFDF8",
  paperBottom: "#F3ECDF",
  fold: "#E4D9C3",
  ribbon: "#26221C",
  lines: "#D8CCB4",
  shadow: "#6B4E00",
} as const;

/** Tilt of the sheet, about the tile's optical centre. */
const TILT = 'transform="rotate(-6 32 33)"';

const DEFS = `<defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BRAND.tileTop}"/>
      <stop offset="1" stop-color="${BRAND.tileBottom}"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".5"/>
      <stop offset=".55" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BRAND.paperTop}"/>
      <stop offset="1" stop-color="${BRAND.paperBottom}"/>
    </linearGradient>
  </defs>`;

const FULL_SHEET = `<g ${TILT}>
    <rect x="18" y="14.5" width="29" height="41" rx="5" fill="${BRAND.shadow}" opacity=".28"/>
    <path d="M23 12h15.5l8.5 8.5V49a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="url(#paper)"/>
    <path d="M38.5 12v5.5a3 3 0 0 0 3 3H47z" fill="${BRAND.fold}"/>
    <path d="M25 12h8.5v16l-4.25-3.2L25 28z" fill="${BRAND.ribbon}"/>
    <path d="M25 37h16M25 43h10" stroke="${BRAND.lines}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
  </g>`;

const SMALL_SHEET = `<g ${TILT}>
    <path d="M21 10h18l9 9v32a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="${BRAND.paperTop}"/>
    <path d="M24 10h11v22l-5.5-4.2L24 32z" fill="${BRAND.ribbon}"/>
  </g>`;

/** The sheet as one shape with the ribbon cut out: only its alpha counts (themed icons). */
const MONO_SHEET = `<g ${TILT}>
    <path fill-rule="evenodd" d="M21 10h18l9 9v32a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4zM24 10v22l5.5-4.2L35 32V10z" fill="#000000"/>
  </g>`;

/**
 * Where the mark sits inside a full-bleed (maskable) tile: scaled to 74% about the centre, so its
 * farthest point stays inside the 80% safe-zone circle a platform mask may cut to.
 */
export const MASKABLE_SCALE = 0.74;

export type IconVariant = "rounded" | "rounded-small" | "full-bleed" | "tile-only" | "monochrome";

/**
 * The mark as SVG. `rounded`: the favicon-style tile with radius 15; `rounded-small`: the same at
 * small sizes; `full-bleed`: a square tile for maskable and Apple touch icons, which the platform
 * rounds itself; `tile-only`: that tile without the mark (what a mask may cut into); `monochrome`:
 * the sheet alone.
 */
export function iconSvg(variant: IconVariant): string {
  const body = {
    rounded: `<rect width="64" height="64" rx="15" fill="url(#tile)"/>
  <rect width="64" height="64" rx="15" fill="url(#sheen)"/>
  <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#FFFFFF" stroke-opacity=".4"/>
  ${FULL_SHEET}`,
    "rounded-small": `<rect width="64" height="64" rx="14" fill="url(#tile)"/>
  ${SMALL_SHEET}`,
    "full-bleed": `<rect width="64" height="64" fill="url(#tile)"/>
  <rect width="64" height="64" fill="url(#sheen)"/>
  <g transform="translate(32 32) scale(${MASKABLE_SCALE}) translate(-32 -32)">${FULL_SHEET}</g>`,
    "tile-only": `<rect width="64" height="64" fill="url(#tile)"/>
  <rect width="64" height="64" fill="url(#sheen)"/>`,
    monochrome: MONO_SHEET,
  }[variant];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${DEFS}
  ${body}
</svg>
`;
}

/** Every rendered icon: its path from the web app's root, its size and which mark it draws. */
export const APP_ICONS: { path: string; size: number; variant: IconVariant }[] = [
  // A rounded tile, as the favicon draws it.
  { path: "public/icons/icon-192.png", size: 192, variant: "rounded" },
  { path: "public/icons/icon-512.png", size: 512, variant: "rounded" },
  // Full bleed: the platform cuts its own shape out of the tile.
  { path: "public/icons/icon-maskable-512.png", size: 512, variant: "full-bleed" },
  // Only the alpha channel counts: the platform tints the mark.
  { path: "public/icons/icon-monochrome-512.png", size: 512, variant: "monochrome" },
  // iOS rounds the touch icon itself and shows black behind transparency, so it is full bleed.
  { path: "app/apple-icon.png", size: 180, variant: "full-bleed" },
  // The PNG favicon for browsers without SVG favicons: the small mark.
  { path: "app/icon.png", size: 32, variant: "rounded-small" },
];
