import { requireMcpAuth } from "@better-auth/mcp";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "mcp-handler";

import { isAllowlisted, parseAllowlist } from "@/lib/auth/allowlist.ts";
import type { createAuth } from "@/lib/auth/auth.ts";

import { registerClippingTools, type McpClippings } from "./tools.ts";

/** An access token's verified claims, as `requireMcpAuth` hands them over. */
type AccessTokenClaims = Parameters<Parameters<typeof requireMcpAuth>[1]>[1];

/**
 * The MCP server behind `/mcp`: stateless, serving spec 2026-07-28 and falling back to stateless
 * Streamable HTTP for 2025-era clients. It expects `request.auth` to be set from a verified
 * access token (see `toAuthInfo`).
 */
export function createClippingsMcpHandler(deps: { clippings: McpClippings; appOrigin: string }) {
  return createMcpHandler((server) => registerClippingTools(server, deps), {
    serverInfo: { name: "clippings", version: "1.0.0" },
    instructions:
      "Clippings is the user's private collection of saved web pages. Save a page they want to keep with save_clipping; find what they saved with search_clippings or list_recent.",
  });
}

/**
 * The verified access token's claims as the MCP SDK's `AuthInfo`: `sub` is the user, `azp` the
 * OAuth client the token was issued to. A token without a user (the provider puts the client id
 * in `sub` then) is refused.
 */
export function toAuthInfo(
  request: Request,
  claims: AccessTokenClaims,
  resource: string,
): AuthInfo {
  const token = request.headers.get("authorization")?.replace(/^(Bearer|DPoP)\s+/i, "") ?? "";
  const clientId = claims.azp ?? claims.client_id;
  const scope = typeof claims.scope === "string" ? claims.scope : "";
  if (typeof clientId !== "string" || typeof claims.sub !== "string" || claims.sub === clientId) {
    throw new Error("The access token names no user or client");
  }
  return {
    token,
    clientId,
    scopes: scope.split(" ").filter(Boolean),
    expiresAt: claims.exp,
    resource: new URL(resource),
    extra: { userId: claims.sub },
  };
}

const refuse = (message: string) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32_000, message }, id: null }, { status: 403 });

/**
 * The `/mcp` route: every request needs an access token issued for `resource`. Without one it
 * gets 401 and a `WWW-Authenticate` challenge pointing at the protected resource metadata, which
 * is how Claude finds the authorization server. The token's user must still be on the allowlist:
 * a refresh token outlives a change to it.
 */
export function createMcpRoute({
  auth,
  clippings,
  resource,
  allowedEmails,
}: {
  auth: ReturnType<typeof createAuth>;
  clippings: McpClippings;
  resource: string;
  allowedEmails: string | undefined;
}) {
  const allowlist = parseAllowlist(allowedEmails);
  const mcp = createClippingsMcpHandler({ clippings, appOrigin: new URL(resource).origin });

  return requireMcpAuth(
    auth,
    async (request, claims) => {
      let authInfo: AuthInfo;
      try {
        authInfo = toAuthInfo(request, claims, resource);
      } catch {
        return refuse("This token doesn't act for a user.");
      }
      const { internalAdapter } = await auth.$context;
      const user = await internalAdapter.findUserById(String(authInfo.extra?.userId));
      if (!isAllowlisted(allowlist, user?.email))
        return refuse("This account is not on the allowlist.");

      request.auth = authInfo;
      return mcp(request);
    },
    { resource },
  );
}
