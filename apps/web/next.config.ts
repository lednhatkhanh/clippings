import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
    // Dev only: records request, fetch and cache spans for /_next/mcp's get_request_insights.
    requestInsights: true,
    // Lets agents draft anonymized Next.js issue reports for review; next dev adds the
    // instructions to AGENTS.md. Needs Next.js telemetry on.
    agentFeedback: true,
  },
};

export default config;
