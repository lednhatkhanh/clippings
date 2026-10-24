import { randomUUID } from "node:crypto";

import type { NextConfig } from "next";

// One id per build, also handed to the code: off Vercel it is the service worker's cache version.
const buildId = randomUUID();

// Only the end-to-end build exposes the testing API `instant()` needs (`EXPOSE_TESTING_API=1`,
// declared in turbo.json's `build` env so a cached normal build is never replayed for it). It goes
// to its own directory: Turborepo restores a cached build over what is there without clearing it,
// so the two builds sharing `.next` leave stale files that break server actions.
const exposeTestingApi = process.env.EXPOSE_TESTING_API === "1";

const config: NextConfig = {
  distDir: exposeTestingApi ? ".next-e2e" : ".next",
  generateBuildId: () => buildId,
  env: { CLIPPINGS_BUILD_ID: buildId },
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  headers: async () => [
    // Every route. The CSP carries only what can't break Next or sign-in: no `script-src` (it
    // needs per-request nonces, which `cacheComponents` prerendering can't have) and no
    // `form-action` (Chrome applies it to the redirect to Google after the sign-in form).
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
        },
      ],
    },
    // The app icons and install screenshots in public/ keep their names across deploys, so a
    // day's caching, then a background check, rather than Next's revalidate-every-time default.
    ...["/icons/:file*", "/screenshots/:file*"].map((source) => ({
      source,
      headers: [
        { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
      ],
    })),
  ],
  experimental: {
    // Keeps a visited page's data for 30 s, so the in-app back link finds the list already rendered
    // and its row's sheet morphs back (React Aria's list renders a newly mounted row a commit late).
    staleTimes: { dynamic: 30 },
    // A bookmarks import posts a file of up to 4 MB (MAX_BOOKMARKS_FILE_BYTES) to a server action,
    // plus a little multipart overhead; the default is 1 MB. Applies to every server action.
    // Vercel Functions refuse a request body over 4.5 MB before Next runs, so this stays under it.
    serverActions: { bodySizeLimit: "4.2mb" },
    turbopackRustReactCompiler: true,
    // Dev only: records request, fetch and cache spans for /_next/mcp's get_request_insights.
    requestInsights: true,
    // Lets agents draft anonymized Next.js issue reports for review; next dev adds the
    // instructions to AGENTS.md. Needs Next.js telemetry on.
    agentFeedback: true,
    exposeTestingApiInProductionBuild: exposeTestingApi,
  },
};

export default config;
