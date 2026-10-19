import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import manifest from "./manifest.ts";

const webRoot = join(import.meta.dirname, "..");
const tokens = JSON.parse(
  readFileSync(
    join(webRoot, "..", "..", "packages", "ui", "src", "generated", "tokens.json"),
    "utf8",
  ),
);
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
