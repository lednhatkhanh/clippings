import { connection } from "next/server";

import { serviceWorkerSource } from "@/lib/pwa/service-worker.ts";

/**
 * The service worker, at the root so its scope is `/`. Its cache version is the deployment id,
 * read per request because Vercel sets it at runtime, else this build's id (`next start`).
 * `no-cache` makes every update check reach the server.
 */
export async function GET() {
  await connection();
  const version = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.CLIPPINGS_BUILD_ID ?? "dev";
  return new Response(serviceWorkerSource(version), {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
