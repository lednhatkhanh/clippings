import { DEFAULT_PALETTE } from "@clippings/shared";
import tokens from "@clippings/ui/tokens.json";

/**
 * iOS launch screens. An installed web app on iOS ignores the manifest's `background_color` and
 * shows an `apple-touch-startup-image` while the first page loads; without one that exactly matches
 * the device, it shows a blank screen, black in dark mode, until the first paint. So each device
 * gets the brand mark centred on the ground, in light and dark. Android builds its own splash from
 * the manifest, and desktop and browser tabs have none (docs/adr/0004-launch-screen.md).
 */

const grounds = tokens.palettes[DEFAULT_PALETTE].schemes.standard;

export type LaunchScheme = "light" | "dark";

/** The page's ground per scheme: the launch screen's color, and the first paint's. */
export const LAUNCH_GROUND: Record<LaunchScheme, string> = {
  light: grounds.light.roles.ground,
  dark: grounds.dark.roles.ground,
};

/** The mark's width on a launch screen, in points: one size on every device. */
export const LAUNCH_MARK_POINTS = 112;

/**
 * Every iPhone and iPad screen iOS 17 and later run on, in portrait points with its pixel ratio.
 * iOS matches `device-width`, `device-height` and the ratio exactly, so a new screen size needs a
 * row here (and `build:app-icons`). Phones launch in portrait; iPads in either orientation.
 */
const DEVICES: { width: number; height: number; ratio: number; tablet?: true }[] = [
  { width: 440, height: 956, ratio: 3 }, // 16 and 17 Pro Max
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus and Pro Max, 16 Plus
  { width: 428, height: 926, ratio: 3 }, // 12 and 13 Pro Max, 14 Plus
  { width: 420, height: 912, ratio: 3 }, // Air
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 414, height: 736, ratio: 3 }, // 8 Plus
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14, 16e
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12 and 13 mini
  { width: 375, height: 667, ratio: 2 }, // 8, SE 2nd and 3rd generation
  { width: 1032, height: 1376, ratio: 2, tablet: true }, // iPad Pro 13" (M4)
  { width: 1024, height: 1366, ratio: 2, tablet: true }, // iPad Pro 12.9", iPad Air 13"
  { width: 834, height: 1210, ratio: 2, tablet: true }, // iPad Pro 11" (M4)
  { width: 834, height: 1194, ratio: 2, tablet: true }, // iPad Pro 11"
  { width: 834, height: 1112, ratio: 2, tablet: true }, // iPad Air 3rd generation
  { width: 820, height: 1180, ratio: 2, tablet: true }, // iPad Air 11", iPad 10th generation
  { width: 810, height: 1080, ratio: 2, tablet: true }, // iPad 7th to 9th generation
  { width: 768, height: 1024, ratio: 2, tablet: true }, // iPad mini 5th generation
  { width: 744, height: 1133, ratio: 2, tablet: true }, // iPad mini 6th generation and later
];

export interface LaunchScreen {
  scheme: LaunchScheme;
  /** Pixel size of the image: the screen's, turned for landscape. */
  width: number;
  height: number;
  /** The mark's width in pixels. */
  mark: number;
  /** Path from the web app's root, and the URL it is served at. */
  path: string;
  url: string;
  /** The media query iOS matches the screen against. */
  media: string;
}

export const LAUNCH_SCREENS: LaunchScreen[] = DEVICES.flatMap(
  ({ width, height, ratio, tablet }) => {
    const orientations = tablet ? (["portrait", "landscape"] as const) : (["portrait"] as const);
    return orientations.flatMap((orientation) =>
      (["light", "dark"] as const).map((scheme) => {
        const [w, h] = orientation === "portrait" ? [width, height] : [height, width];
        const name = `${scheme}-${w * ratio}x${h * ratio}.png`;
        return {
          scheme,
          width: w * ratio,
          height: h * ratio,
          mark: LAUNCH_MARK_POINTS * ratio,
          path: `public/launch/${name}`,
          url: `/launch/${name}`,
          // `device-width` and `device-height` stay the portrait ones when the device turns.
          media: `screen and (device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation}) and (prefers-color-scheme: ${scheme})`,
        };
      }),
    );
  },
);

/**
 * Inline CSS for `<head>`: the ground on `<html>` before the stylesheets arrive, following
 * `data-theme` (set by the no-flash script) or the OS. Whatever paints first, between the launch
 * screen and the styled page, is the ground and never the browser's black or white canvas.
 */
export const FIRST_PAINT_STYLE = `html{background-color:${LAUNCH_GROUND.light}}@media (prefers-color-scheme:dark){html:not([data-theme=light]){background-color:${LAUNCH_GROUND.dark}}}html[data-theme=dark]{background-color:${LAUNCH_GROUND.dark}}`;
