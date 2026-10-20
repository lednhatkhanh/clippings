import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { REQUESTED_PATH_HEADER } from "@/lib/auth/return-path.ts";

import { config, proxy } from "./proxy.ts";

const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("the proxy's matcher", () => {
  it.each(["/", "/c/abc123", "/tags", "/settings", "/share?url=https%3A%2F%2Fexample.com"])(
    "gates the app page %s",
    (url) => {
      expect(runsOn(url)).toBe(true);
    },
  );

  it.each([
    "/sign-in",
    "/offline",
    "/api/auth/callback/google",
    "/api/health",
    "/api/extension/clippings",
    "/_next/static/chunks/app.js",
    // The consent page checks the session itself, so the authorization in its query survives.
    "/connect?client_id=abc&sig=xyz",
    "/connect/closed?reason=private",
    // `/mcp` and discovery answer with an OAuth challenge or metadata, not a redirect.
    "/mcp",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server/api/auth",
    // Files with an extension: the service worker, the manifest, icons.
    "/sw.js",
    "/manifest.webmanifest",
    "/icon.png",
  ])("leaves %s alone", (url) => {
    expect(runsOn(url)).toBe(false);
  });
});

describe("the proxy", () => {
  const BASE = "https://clippings.test";
  const signedIn = { cookie: "better-auth.session_token=abc.def" };

  it("sends a signed-out page request to sign-in, coming back to the page afterwards", () => {
    const response = proxy(new NextRequest(`${BASE}/c/abc?tab=note`));
    expect(getRedirectUrl(response)).toBe(
      `${BASE}/sign-in?returnTo=${encodeURIComponent("/c/abc?tab=note")}`,
    );
  });

  it("sends a signed-out visitor to the home page to plain sign-in", () => {
    const response = proxy(new NextRequest(`${BASE}/`));
    expect(getRedirectUrl(response)).toBe(`${BASE}/sign-in`);
  });

  it("never returns to a path that would leave the site", () => {
    const response = proxy(new NextRequest(`${BASE}//evil.example/steal`));
    expect(getRedirectUrl(response)).toBe(`${BASE}/sign-in`);
  });

  it("lets a request with a session cookie through, naming the requested path for the layout", () => {
    const response = proxy(new NextRequest(`${BASE}/tags?sort=name`, { headers: signedIn }));

    expect(getRedirectUrl(response)).toBeNull();
    expect(response.headers.get(`x-middleware-request-${REQUESTED_PATH_HEADER}`)).toBe(
      "/tags?sort=name",
    );
  });

  it("overwrites a requested-path header the client sent", () => {
    const response = proxy(
      new NextRequest(`${BASE}/tags`, {
        headers: { ...signedIn, [REQUESTED_PATH_HEADER]: "/forged" },
      }),
    );
    expect(response.headers.get(`x-middleware-request-${REQUESTED_PATH_HEADER}`)).toBe("/tags");
  });
});
