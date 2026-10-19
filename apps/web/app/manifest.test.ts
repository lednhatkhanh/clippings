import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import tokens from "@clippings/ui/tokens.json";

import manifest from "./manifest.ts";

const webRoot = join(import.meta.dirname, "..");
const olive = tokens.palettes.olive.schemes.standard.light.roles;
const app = manifest();

/** A `#rrggbb` color as its three channels. */
function channels(hex: string) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

function publicFile(src: string) {
  return join(webRoot, "public", src);
}

describe("manifest", () => {
  it("takes its colors from the olive light scheme in tokens.json", () => {
    expect(app.theme_color).toBe(olive.surface);
    expect(app.background_color).toBe(olive.background);
  });

  it.each([...(app.icons ?? []), ...(app.screenshots ?? [])])(
    "serves $src at its declared size",
    async ({ src, sizes }) => {
      const { width, height } = await sharp(publicFile(src)).metadata();
      expect(`${width}x${height}`).toBe(sizes);
    },
  );

  it("draws the icons on the olive secondary-container tile", async () => {
    // A corner pixel inside the 512 px icon's rounded tile, so a token change shows up as a
    // stale icon until `build:app-icons` runs again.
    const { data } = await sharp(publicFile("/icons/icon-512.png"))
      .extract({ left: 64, top: 64, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data]).toEqual(channels(olive["secondary-container"]));
  });

  it("keeps the whole mark inside the maskable icon's safe zone", async () => {
    const icon = app.icons?.find(({ purpose }) => purpose === "maskable");
    expect(icon).toBeDefined();
    const { data, info } = await sharp(publicFile(icon?.src ?? ""))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // The safe zone is the circle with 80% of the icon's width as its diameter: a platform mask
    // may cut anything outside it, so everything there must be plain tile.
    const tile = channels(olive["secondary-container"]);
    const center = info.width / 2;
    const safeRadius = info.width * 0.4;
    let markInside = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        const isTile = tile.every((value, i) => Math.abs((data[offset + i] ?? 0) - value) <= 2);
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
