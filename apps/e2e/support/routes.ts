import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./env.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
export type Method = (typeof METHODS)[number];

export interface RouteHandler {
  /** The route file, relative to the app directory, such as `api/clippings/[id]/route.ts`. */
  file: string;
  /** A request path that reaches it: dynamic segments are filled with a sample value. */
  path: string;
  method: Method;
}

const APP_DIR = path.join(REPO_ROOT, "apps/web/app");

function* routeFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* routeFiles(full);
    else if (entry.name === "route.ts") yield full;
  }
}

/** `[id]` becomes a sample value; `[...all]` and `[[...all]]` take a sample segment or none. */
function toPath(file: string): string {
  const segments = path
    .dirname(file)
    .split(path.sep)
    // A `(group)` folder is not part of the URL.
    .filter((segment) => segment !== "." && !/^\(.*\)$/.test(segment))
    .flatMap((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return [];
      if (/^\[\.\.\..+\]$/.test(segment)) return ["sample"];
      if (/^\[.+\]$/.test(segment)) return ["sample"];
      return [segment];
    });
  return `/${segments.join("/")}`;
}

/**
 * Every HTTP handler the app declares, read from the route files themselves, so a new route is
 * covered the moment it exists.
 */
export function routeHandlers(): RouteHandler[] {
  return [...routeFiles(APP_DIR)].sort().flatMap((full) => {
    const file = path.relative(APP_DIR, full);
    const source = readFileSync(full, "utf8");
    return METHODS.filter((method) =>
      new RegExp(`export\\s+(?:(?:async\\s+)?function|const)\\s+${method}\\b`).test(source),
    ).map((method) => ({ file, path: toPath(file), method }));
  });
}

/** Every route file, to check that each one declared a handler this reader recognized. */
export function routeFilesFound(): string[] {
  return [...routeFiles(APP_DIR)].map((full) => path.relative(APP_DIR, full)).sort();
}
