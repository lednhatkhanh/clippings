// Offline check, run in CI through the `lint` task:
//   1. the subset font was built from the current ICON_NAMES;
//   2. every Icon element with a literal name in the repo uses a name in ICON_NAMES.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ICON_NAMES } from "../src/icons/icon-names";

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(uiRoot, "..", "..");
const known = new Set<string>(ICON_NAMES);
const problems: string[] = [];

const manifest = JSON.parse(
  readFileSync(join(uiRoot, "src", "fonts", "material-symbols-rounded.json"), "utf8"),
) as { icons: string[] };
const built = new Set(manifest.icons);
for (const name of known) {
  if (!built.has(name))
    problems.push(`"${name}" is in ICON_NAMES but not in the font; run build:icons`);
}
for (const name of built) {
  if (!known.has(name))
    problems.push(`"${name}" is in the font but not in ICON_NAMES; run build:icons`);
}

const SKIP = new Set(["node_modules", ".next", ".wxt", ".output", ".turbo", ".git", "generated"]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|jsx?)$/.test(entry) ? [path] : [];
  });

const ICON_JSX = /<Icon\b[^>]*?\bname=(?:"([^"]+)"|\{\s*"([^"]+)"\s*\})/g;

for (const root of ["apps", "packages"]) {
  for (const file of walk(join(repoRoot, root))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(ICON_JSX)) {
      const name = match[1] ?? match[2];
      if (name && !known.has(name)) {
        problems.push(`${relative(repoRoot, file)}: icon "${name}" is not in the icon subset`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Icon subset ok (${known.size} icons).`);
