import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { APP_ICONS, iconSvg } from "@/lib/pwa/app-icon.ts";
import { renderIconPng } from "@/lib/pwa/render-app-icon.ts";
import tokens from "@clippings/ui/tokens.json";

import manifest from "./manifest.ts";

const webRoot = join(import.meta.dirname, "..");
const olive = tokens.palettes.olive.schemes.standard.light.roles;
const app = manifest();

function publicFile(src: string) {
  return join(webRoot, "public", src);
}

async function pixels(png: Buffer | string) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

describe("manifest", () => {
  it("paints the splash and title bar in the olive light scheme's ground", () => {
    expect(app.theme_color).toBe(olive.ground);
    expect(app.background_color).toBe(olive.ground);
  });

  it.each([...(app.icons ?? []), ...(app.screenshots ?? [])])(
    "serves $src at its declared size",
    async ({ src, sizes }) => {
      const { width, height } = await sharp(publicFile(src)).metadata();
      expect(`${width}x${height}`).toBe(sizes);
    },
  );

  it.each(APP_ICONS)(
    "keeps $path current with the mark's source",
    async ({ path, size, variant }) => {
      // A changed mark shows up here until `build:app-icons` runs again.
      const committed = await pixels(join(webRoot, path));
      const fresh = await pixels(await renderIconPng(variant, size));
      expect(committed.info.width).toBe(size);
      let largest = 0;
      for (let i = 0; i < fresh.data.length; i++) {
        largest = Math.max(largest, Math.abs((committed.data[i] ?? 0) - (fresh.data[i] ?? 0)));
      }
      expect(largest).toBeLessThanOrEqual(2);
    },
  );

  it("serves the small mark as the SVG favicon", () => {
    expect(readFileSync(join(webRoot, "app", "icon.svg"), "utf8")).toBe(iconSvg("rounded-small"));
  });

  it("keeps the whole mark inside the maskable icon's safe zone", async () => {
    const icon = app.icons?.find(({ purpose }) => purpose === "maskable");
    expect(icon).toBeDefined();
    const { data, info } = await pixels(publicFile(icon?.src ?? ""));
    const tile = await pixels(
      await sharp(Buffer.from(iconSvg("tile-only")), { density: (72 * info.width) / 64 })
        .resize(info.width, info.height)
        .png()
        .toBuffer(),
    );

    // The safe zone is the circle with 80% of the icon's width as its diameter: a platform mask
    // may cut anything outside it, so everything there must be plain tile.
    const center = info.width / 2;
    const safeRadius = info.width * 0.4;
    let markInside = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        const isTile = [0, 1, 2].every(
          (i) => Math.abs((data[offset + i] ?? 0) - (tile.data[offset + i] ?? 0)) <= 2,
        );
        if (Math.hypot(x + 0.5 - center, y + 0.5 - center) > safeRadius) {
          if (!isTile) throw new Error(`Mark outside the safe zone at ${x},${y}`);
        } else if (!isTile) {
          markInside++;
        }
      }
    }
    expect(markInside).toBeGreaterThan(0);
  });
});
