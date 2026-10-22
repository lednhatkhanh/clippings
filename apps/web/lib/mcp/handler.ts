import { requireMcpAuth } from "@better-auth/mcp";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { APIError } from "better-auth/api";
import { fromUnixTime } from "date-fns";
import { createMcpHandler } from "mcp-handler";

import { isAllowlisted, parseAllowlist } from "@/lib/auth/allowlist.ts";
import type { createAuth } from "@/lib/auth/auth.ts";
import type { ConnectionsService } from "@clippings/db";

import { WRITE_SCOPE } from "./scopes.ts";
import { registerClippingTools, type McpClippings } from "./tools.ts";

/** An access token's verified claims, as `requireMcpAuth` hands them over. */
type AccessTokenClaims = Parameters<Parameters<typeof requireMcpAuth>[1]>[1];

const READ_INSTRUCTIONS =
  "Clippings is the user's private collection of saved web pages. Save a page they want to keep with save_clipping; find what they saved with search_clippings, list_recent or, filtered by tag, date or pin, list_clippings; related_clippings finds ones close in meaning to another.";

const WRITE_INSTRUCTIONS = `${READ_INSTRUCTIONS} Read one clipping with get_clipping, and the page text Clippings saved for it with get_page_text. Change its title, note or tags with update_clipping; tag_clippings adds or removes tags on many at once, and rename_tag and merge_tag tidy the tags themselves. Call list_tags before tagging and reuse the user's tags. delete_clipping can be undone with restore_clipping for 24 hours. Change or delete only what the user asked you to.`;

/**
 * The MCP server behind `/mcp`: stateless, serving spec 2026-07-28 and falling back to stateless
 * Streamable HTTP for 2025-era clients. It expects `request.auth` to be set from a verified
 * access token (see `toAuthInfo`).
 *
 * Two servers are built once, one that saves and searches and one that also reads one clipping,
 * edits, tags and deletes, and each request goes to the one its token's scopes allow: only a
 * token with `clippings:write` is offered the write tools in `tools/list`, and any other token
 * calling one gets the same "unknown tool" error as for a tool that doesn't exist.
 */
export function createClippingsMcpHandler(deps: { clippings: McpClippings; appOrigin: string }) {
  const serverFor = (write: boolean) =>
    createMcpHandler((server) => registerClippingTools(server, deps, { write }), {
      serverInfo: { name: "clippings", version: "1.0.0" },
      instructions: write ? WRITE_INSTRUCTIONS : READ_INSTRUCTIONS,
    });
  const readOnly = serverFor(false);
  const readWrite = serverFor(true);

  return (request: Request) =>
    (request.auth?.scopes.includes(WRITE_SCOPE) ? readWrite : readOnly)(request);
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
 * 401 for a token whose client the user revoked, with the same challenge as a missing token, so
 * the client signs in again.
 */
function revoked(resource: string): Response {
  const challenge = createResourceServerChallenge(
    new APIError("UNAUTHORIZED", { message: "This client's access was revoked." }),
    resource,
  )!;
  const headers = new Headers(challenge.headers);
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32_000, message: challenge.message },
      id: null,
    }),
    { status: 401, headers },
  );
}

/**
 * The `/mcp` route: every request needs an access token issued for `resource`. Without one it
 * gets 401 and a `WWW-Authenticate` challenge pointing at the protected resource metadata, which
 * is how Claude finds the authorization server. The token's user must still be on the allowlist:
 * a refresh token outlives a change to it. Access tokens are JWTs nothing stores, so a token
 * issued before the user revoked its client in Settings also gets 401; every other call is
 * recorded as the client's last use.
 */
export function createMcpRoute({
  auth,
  clippings,
  connections,
  resource,
  allowedEmails,
}: {
  auth: ReturnType<typeof createAuth>;
  clippings: McpClippings;
  connections: Pick<ConnectionsService, "recordUse">;
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
      const userId = String(authInfo.extra?.userId);
      const { internalAdapter } = await auth.$context;
      const user = await internalAdapter.findUserById(userId);
      if (!isAllowlisted(allowlist, user?.email))
        return refuse("This account is not on the allowlist.");

      // Better Auth always sets `iat`; a token without one can't be checked, so it is refused.
      if (typeof claims.iat !== "number") return revoked(resource);
      const issuedAt = fromUnixTime(claims.iat);
      if (!(await connections.recordUse(userId, authInfo.clientId, issuedAt))) {
        return revoked(resource);
      }

      request.auth = authInfo;
      return mcp(request);
    },
    { resource },
  );
}
