import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { WEB_DIR } from "./env.ts";

/** Where Next writes each route's prerendered static shell, in the production build. */
const SHELLS_DIR = path.join(WEB_DIR, ".next/server/app");

/**
 * Serves the route's prerendered static shell as its document, which is what a CDN returns first
 * on a person's first visit to a page. The origin answers a document request with the shell and
 * the page's dynamic content streamed after it, in one response, and the content arrives in
 * milliseconds. A test could then not tell what was in the shell from what followed it, and the
 * `instant()` lock cannot hold the streamed content back. The shell file holds only what a
 * request doesn't change, and the client still hydrates it through the real testing API:
 * `instant()`'s cookie makes the page fetch its static payload from the server.
 *
 * Call it inside `instant()`, before `page.goto`, and call the returned function before the lock
 * is released, so the refresh that follows streams the real page.
 *
 * @param pathname The route's path in the browser, such as `/c/0b1d…`.
 * @param shellFile The shell's file under `.next/server/app`, such as `c/[id].html`.
 */
export async function serveStaticShell(page: Page, pathname: string, shellFile: string) {
  const html = readFileSync(path.join(SHELLS_DIR, shellFile), "utf8");
  const matches = (url: URL) => url.pathname === pathname;
  await page.route(matches, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
  return () => page.unroute(matches);
}
