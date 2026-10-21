import sharp from "sharp";

import { iconSvg, type IconVariant } from "./app-icon.ts";

/**
 * One icon as PNG, for the build script and the test that checks the committed files are current.
 * Node only (sharp). A full-bleed tile is opaque, so its alpha channel goes and iOS can't guess.
 */
export async function renderIconPng(variant: IconVariant, size: number): Promise<Buffer> {
  const image = sharp(Buffer.from(iconSvg(variant)), { density: (72 * size) / 64 }).resize(
    size,
    size,
  );
  return (variant === "full-bleed" ? image.removeAlpha() : image)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
