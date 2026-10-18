// Build-time generator for everything in `src/generated`. Run with tsx (material-color-utilities
// 0.4.0 cannot be imported by plain Node ESM).
//
//   tsx scripts/generate-theme.ts          write the files
//   tsx scripts/generate-theme.ts --check  fail if the files on disk are stale

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateTheme, renderThemesCss, renderTokensJson } from "../src/theme/generate.ts";
import { renderSpringsCss } from "../src/theme/springs.ts";
import { renderTypescaleCss } from "../src/tokens/typescale-css.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "generated");
const theme = generateTheme();

const files: Record<string, string> = {
  "themes.css": renderThemesCss(theme),
  "springs.css": renderSpringsCss(),
  "typescale.css": renderTypescaleCss(),
  "tokens.json": renderTokensJson(theme),
};

const check = process.argv.includes("--check");
const stale: string[] = [];

mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(outDir, name);
  if (check) {
    let current: string | null = null;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      // Missing counts as stale.
    }
    if (current !== content) stale.push(name);
  } else {
    writeFileSync(path, content);
  }
}

if (check && stale.length > 0) {
  console.error(
    `Generated theme files are stale: ${stale.join(", ")}. Run \`pnpm --filter @clippings/ui generate\`.`,
  );
  process.exit(1);
}
