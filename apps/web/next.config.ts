import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
};

export default config;
