// Builds the Material Symbols Rounded subset font from ICON_NAMES.
//
//   tsx scripts/build-icons.ts
//
// Needs network access. Writes src/fonts/material-symbols-rounded.woff2 and a manifest the
// offline check (check-icons.ts) compares against the icon list.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ICON_NAMES } from "../src/icons/icon-names";

const AXES = "opsz,wght,FILL,GRAD@20..24,300..500,0..1,-25..0";
// Google serves woff2 only to modern user agents.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const fontsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "fonts");
const iconNames = [...ICON_NAMES].toSorted();

const cssUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:${AXES}&icon_names=${iconNames.join(",")}&display=block`;
const css = await (await fetch(cssUrl, { headers: { "User-Agent": USER_AGENT } })).text();
const fontUrl = /src: url\((https:[^)]+)\) format\('woff2'\)/.exec(css)?.[1];
if (!fontUrl) throw new Error(`No woff2 URL in the Google Fonts response:\n${css.slice(0, 400)}`);

const response = await fetch(fontUrl);
if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
const font = Buffer.from(await response.arrayBuffer());

mkdirSync(fontsDir, { recursive: true });
writeFileSync(join(fontsDir, "material-symbols-rounded.woff2"), font);
writeFileSync(
  join(fontsDir, "material-symbols-rounded.json"),
  `${JSON.stringify({ axes: AXES, icons: iconNames }, null, 2)}\n`,
);
console.log(`Wrote ${font.length} bytes for ${iconNames.length} icons.`);
