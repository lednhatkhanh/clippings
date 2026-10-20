import { randomUUID } from "node:crypto";

import type { NextConfig } from "next";

// One id per build, also handed to the code: off Vercel it is the service worker's cache version.
const buildId = randomUUID();

// Only the end-to-end build exposes the testing API `instant()` needs (`EXPOSE_TESTING_API=1`,
// declared in turbo.json's `build` env so a cached normal build is never replayed for it).
const exposeTestingApi = process.env.EXPOSE_TESTING_API === "1";

const config: NextConfig = {
  generateBuildId: () => buildId,
  env: { CLIPPINGS_BUILD_ID: buildId },
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  experimental: {
    // Keeps a visited page's data for 30 s, so the in-app back link finds the list already rendered
    // and its row's sheet morphs back (React Aria's list renders a newly mounted row a commit late).
    staleTimes: { dynamic: 30 },
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
