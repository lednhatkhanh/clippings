import { describe, expect, it } from "vitest";

import { clientDisplayName } from "./connections.ts";

describe("clientDisplayName", () => {
  it("uses the name the client registered with", () => {
    expect(clientDisplayName({ clientId: "abc", name: " Claude Code ", uri: null })).toBe(
      "Claude Code",
    );
  });

  it("falls back to the host of its home page, then of its metadata document URL", () => {
    expect(clientDisplayName({ clientId: "abc", name: "", uri: "https://claude.ai/home" })).toBe(
      "claude.ai",
    );
    expect(
      clientDisplayName({ clientId: "https://claude.ai/oauth/client.json", name: null, uri: null }),
    ).toBe("claude.ai");
  });

  it("falls back to the id when nothing else names it", () => {
    expect(clientDisplayName({ clientId: "dyn-123", name: null, uri: null })).toBe("dyn-123");
  });
});
