import { describe, expect, it } from "vitest";

import { signedOAuthQuery } from "./oauth-query.ts";

describe("signedOAuthQuery", () => {
  it("keeps the signed parameters and drops the page's own", () => {
    const query = signedOAuthQuery({
      client_id: "https://claude.ai/oauth/claude-code-client-metadata",
      scope: "openid offline_access",
      exp: "1760000000",
      ba_param: ["ba_param", "client_id", "exp", "scope"],
      sig: "abc",
      error: "not_allowlisted",
    });

    const params = new URLSearchParams(query);
    expect(params.get("client_id")).toBe("https://claude.ai/oauth/claude-code-client-metadata");
    expect(params.get("sig")).toBe("abc");
    expect(params.getAll("ba_param")).toEqual(["ba_param", "client_id", "exp", "scope"]);
    expect(params.has("error")).toBe(false);
  });

  it("is undefined without a signed request", () => {
    expect(signedOAuthQuery({})).toBeUndefined();
    expect(signedOAuthQuery({ error: "x" })).toBeUndefined();
    expect(signedOAuthQuery({ sig: "abc", client_id: "x" })).toBeUndefined();
  });
});
