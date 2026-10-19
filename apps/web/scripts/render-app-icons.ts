// Renders the manifest icons from one SVG source of the Clippings mark (app/icon.svg draws the
// same mark for the favicon).
//
//   pnpm --filter @clippings/web build:app-icons
//
// Writes public/icons/. Installed icons don't follow the user's palette (the OS caches them), so
// they take the default olive scheme's secondary-container tile from tokens.json.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { DEFAULT_PALETTE } from "@clippings/shared";
import tokens from "@clippings/ui/tokens.json" with { type: "json" };

const roles = tokens.palettes[DEFAULT_PALETTE].schemes.standard.light.roles;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

/**
 * The mark on a 64-unit grid: a paper clip bent into a "C". Its farthest point is about 23 units
 * from the centre, inside the maskable safe zone's 25.6 (80% of the tile), so every variant draws
 * it at the same scale.
 */
function markSvg({ tile, clip, radius }: { tile?: string; clip: string; radius?: number }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${tile ? `<rect width="64" height="64" rx="${radius ?? 0}" fill="${tile}" />` : ""}
  <path d="M46 18H27A14 14 0 0 0 27 46H43A8 8 0 0 0 43 30H30A4 4 0 0 0 30 38H40" fill="none"
    stroke="${clip}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;
}

const tile = roles["secondary-container"];
const clip = roles["on-secondary-container"];
const icons = [
  // A rounded tile, as the favicon draws it.
  { file: "icon-192.png", size: 192, svg: markSvg({ tile, clip, radius: 16 }) },
  { file: "icon-512.png", size: 512, svg: markSvg({ tile, clip, radius: 16 }) },
  // Full bleed: the platform cuts its own shape out of the tile.
  { file: "icon-maskable-512.png", size: 512, svg: markSvg({ tile, clip }) },
  // Only the alpha channel counts: the platform tints the mark.
  { file: "icon-monochrome-512.png", size: 512, svg: markSvg({ clip: "#000000" }) },
];

mkdirSync(outDir, { recursive: true });
for (const { file, size, svg } of icons) {
  await sharp(Buffer.from(svg), { density: (72 * size) / 64 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(outDir, file));
  console.log(`Wrote ${file}`);
}
