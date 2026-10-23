// Renders every icon of the Clippings mark from one SVG source (lib/pwa/app-icon.ts).
//
//   pnpm --filter @clippings/web build:app-icons
//
// Writes the manifest icons to public/icons/ and the favicon set to app/ (icon.svg, icon.png,
// apple-icon.png), which Next.js serves through its file conventions, and the iOS launch screens
// to public/launch/.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_ICONS, iconSvg } from "@/lib/pwa/app-icon.ts";
import { LAUNCH_SCREENS } from "@/lib/pwa/launch-screen.ts";
import { renderIconPng, renderLaunchScreenPng } from "@/lib/pwa/render-app-icon.ts";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

mkdirSync(join(webRoot, "public", "icons"), { recursive: true });
for (const { path, size, variant } of APP_ICONS) {
  writeFileSync(join(webRoot, path), await renderIconPng(variant, size));
  console.log(`Wrote ${path}`);
}

// Tabs draw the SVG favicon at 16-32px, so it is the small mark.
writeFileSync(join(webRoot, "app", "icon.svg"), iconSvg("rounded-small"));
console.log("Wrote app/icon.svg");

mkdirSync(join(webRoot, "public", "launch"), { recursive: true });
for (const screen of LAUNCH_SCREENS) {
  writeFileSync(join(webRoot, screen.path), await renderLaunchScreenPng(screen));
  console.log(`Wrote ${screen.path}`);
}
