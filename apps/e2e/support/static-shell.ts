import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { WEB_DIR } from "./env.ts";

/** Where Next writes each route's prerendered static shell, in the production build. */
const SHELLS_DIR = path.join(WEB_DIR, ".next-e2e/server/app");

/**
 * Serves the route's prerendered static shell as its document, which is what a CDN returns first
 * on a person's first visit to a page. The origin answers a document request with the shell and
 * the page's dynamic content streamed after it, in one response, and the content arrives in
 * milliseconds. A test could then not tell what was in the shell from what followed it, and the
 * `instant()` lock cannot hold the streamed content back. The shell file holds only what a
 * request doesn't change, and the client still hydrates it through the real testing API:
 * `instant()`'s cookie makes the page fetch its static payload from the server.
 *
 * Since Next 16.4.4 the shell file no longer boots the client: Turbopack's chunk registrations
 * (`globalThis.TURBOPACK.push(…)`) moved into the resume that follows the shell, so they get the
 * CSP nonce. A CDN sends the resume after the shell in the same response; here they are taken from
 * the live document and appended to the shell, and the rest of the resume, the page's data, is
 * dropped.
 *
 * Call it inside `instant()`, before `page.goto`, and call the returned function before the lock
 * is released, so the refresh that follows streams the real page.
 *
 * @param pathname The route's path in the browser, such as `/c/0b1d…`.
 * @param shellFile The shell's file under `.next-e2e/server/app`, such as `c/[id].html`.
 */
export async function serveStaticShell(page: Page, pathname: string, shellFile: string) {
  const shell = readFileSync(path.join(SHELLS_DIR, shellFile), "utf8");
  const matches = (url: URL) => url.pathname === pathname;
  await page.route(matches, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const live = await route.fetch();
    const bootstrap = turbopackBootstrap(await live.text());
    // The shell stops where the resume would continue it, so there is no `</body>` to insert
    // before: the bootstrap goes at the end, where the resume starts.
    const body = `${shell}<script>${bootstrap}</script>`;
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  });
  return () => page.unroute(matches);
}

/** The Turbopack chunk registrations in a rendered document, as one script's source. */
function turbopackBootstrap(html: string) {
  const pushes = html.match(/\(globalThis\["TURBOPACK"\][^;]*?\)\.push\(\{.*?\}\);/g);
  if (!pushes) throw new Error("The live document registers no Turbopack chunks");
  return pushes.join("");
}
