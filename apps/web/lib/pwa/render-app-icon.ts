import sharp from "sharp";

import { iconSvg, type IconVariant } from "./app-icon.ts";
import { LAUNCH_GROUND, type LaunchScreen } from "./launch-screen.ts";

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

/** One iOS launch screen as PNG: the rounded mark centred on the ground. Node only (sharp). */
export async function renderLaunchScreenPng(screen: LaunchScreen): Promise<Buffer> {
  return sharp({
    create: {
      width: screen.width,
      height: screen.height,
      channels: 3,
      background: LAUNCH_GROUND[screen.scheme],
    },
  })
    .composite([{ input: await renderIconPng("rounded", screen.mark), gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
