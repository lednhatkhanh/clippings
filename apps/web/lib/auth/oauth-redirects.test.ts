import { describe, expect, it } from "vitest";

import { isAllowedRedirectUri } from "./oauth-redirects.ts";

describe("isAllowedRedirectUri", () => {
  it("accepts claude.ai's connector callback", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("https://claude.com/api/mcp/auth_callback")).toBe(true);
  });

  it("accepts a loopback port, as Claude Code uses", () => {
    expect(isAllowedRedirectUri("http://localhost:53682/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:41234/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://[::1]:8080/callback")).toBe(true);
  });

  it("refuses anywhere else", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/other")).toBe(false);
    expect(isAllowedRedirectUri("https://evil.example/api/mcp/auth_callback")).toBe(false);
    expect(isAllowedRedirectUri("https://localhost:8080/callback")).toBe(false);
    expect(isAllowedRedirectUri("http://localhost.evil.example/callback")).toBe(false);
    expect(isAllowedRedirectUri("http://127.1:8080/callback")).toBe(false);
    expect(isAllowedRedirectUri("http://user@127.0.0.1:8080/callback")).toBe(false);
    expect(isAllowedRedirectUri("http://127.0.0.1:8080/callback#x")).toBe(false);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
});
