import { createHash, createHmac, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuth } from "@/lib/auth/auth.ts";
import { createDatabase, createPool } from "@clippings/db";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

import { createMcpRoute } from "./handler.ts";
import { mcpResourceUrl } from "./resource.ts";

const ORIGIN = "http://localhost:3999";
const SECRET = "test-secret-test-secret-test-secret-0123";
const RESOURCE = mcpResourceUrl(ORIGIN);
const REDIRECT_URI = "http://127.0.0.1:43210/callback";
const ALLOWED = "ada@example.com";

describe.skipIf(!TEST_DATABASE_URL)("connecting a client and calling /mcp", () => {
  let fixture: ServiceFixture;
  let pool: ReturnType<typeof createPool>;

  /** The app's auth and `/mcp` route with this allowlist, on the test database. */
  function app(allowedEmails: string) {
    const auth = createAuth({
      database: createDatabase(pool),
      baseURL: ORIGIN,
      secret: SECRET,
      allowedEmails,
      google: { clientId: "test", clientSecret: "test" },
    });
    const mcp = createMcpRoute({
      auth,
      clippings: fixture.service,
      resource: RESOURCE,
      allowedEmails,
    });
    // `/mcp` fetches the signing keys from the app's own URL.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      auth.handler(new Request(input, init)),
    );
    const call = (path: string, init?: RequestInit) =>
      auth.handler(new Request(`${ORIGIN}${path}`, init));
    return { auth, mcp, call };
  }

  /** A signed-in browser for this user: their session cookie, as Better Auth signs it. */
  async function signIn(id: string, email: string) {
    await pool.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, $1, $2, true)`,
      [id, email],
    );
    const token = `session-${id}-${randomBytes(8).toString("hex")}`;
    await pool.query(
      `insert into session (id, "expiresAt", token, "updatedAt", "userId") values ($1, now() + interval '1 day', $2, now(), $3)`,
      [`s-${id}`, token, id],
    );
    const signature = createHmac("sha256", SECRET).update(token).digest("base64");
    return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  }

  const browser = { accept: "text/html", "sec-fetch-mode": "navigate" };

  /** Where a response sends the browser: its Location, or the provider's JSON redirect. */
  async function target(response: Response): Promise<string> {
    const location = response.headers.get("location");
    if (location) return location;
    const body = (await response.json()) as { url?: string };
    return body.url ?? "";
  }

  async function register(call: ReturnType<typeof app>["call"]) {
    const response = await call("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Code",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
      }),
    });
    return ((await response.json()) as { client_id: string }).client_id;
  }

  function authorizePath(clientId: string, challenge: string, prompt?: string) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      // Another loopback port than the registered one, as Claude Code picks a free port.
      redirect_uri: "http://127.0.0.1:51234/callback",
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    if (prompt) params.set("prompt", prompt);
    return `/api/auth/oauth2/authorize?${params}`;
  }

  function pkce() {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  }

  /** Authorizes as the signed-in user, allows on the consent page, and trades the code. */
  async function connect(setup: ReturnType<typeof app>, cookie: string, clientId: string) {
    const { verifier, challenge } = pkce();
    const consentPage = await target(
      await setup.call(authorizePath(clientId, challenge), { headers: { cookie, ...browser } }),
    );
    expect(consentPage).toMatch(/^\/connect\?/);

    const consent = await setup.call("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: ORIGIN },
      body: JSON.stringify({ accept: true, oauth_query: consentPage.slice("/connect?".length) }),
    });
    const callback = new URL(await target(consent));
    expect(callback.origin).toBe("http://127.0.0.1:51234");

    const token = await setup.call("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code") ?? "",
        redirect_uri: "http://127.0.0.1:51234/callback",
        client_id: clientId,
        code_verifier: verifier,
        resource: RESOURCE,
      }),
    });
    expect(token.status).toBe(200);
    return (await token.json()) as { access_token: string; refresh_token: string };
  }

  function listTools(mcp: ReturnType<typeof app>["mcp"], accessToken?: string) {
    return mcp(
      new Request(RESOURCE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
  }

  beforeEach(async () => {
    fixture = await createServiceFixture();
    pool = createPool(fixture.databaseUrl);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await pool.end();
    await fixture.close();
  });

  it("challenges a call without a token, pointing at the resource metadata", async () => {
    const { mcp, call } = app(ALLOWED);
    const response = await listTools(mcp);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    const metadata = await call("/.well-known/oauth-protected-resource/mcp");
    expect(await metadata.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [`${ORIGIN}/api/auth`],
    });
  });

  it("connects a loopback client with PKCE and serves its tools", async () => {
    const setup = app(ALLOWED);
    const cookie = await signIn("ada", ALLOWED);
    const tokens = await connect(setup, cookie, await register(setup.call));

    expect(tokens.refresh_token).toBeTruthy();
    const response = await listTools(setup.mcp, tokens.access_token);
    expect(response.status).toBe(200);
  });

  it("asks for consent every time, even after the user allowed the client", async () => {
    const setup = app(ALLOWED);
    const cookie = await signIn("ada", ALLOWED);
    const clientId = await register(setup.call);
    await connect(setup, cookie, clientId);

    const again = await target(
      await setup.call(authorizePath(clientId, pkce().challenge, "none"), {
        headers: { cookie, ...browser },
      }),
    );
    expect(again).toMatch(/^\/connect\?/);
  });

  it("refuses an account that is no longer on the allowlist", async () => {
    const setup = app(`${ALLOWED} bob@example.com`);
    const ada = await signIn("ada", ALLOWED);
    const bob = await signIn("bob", "bob@example.com");
    const clientId = await register(setup.call);
    const bobsTokens = await connect(setup, bob, clientId);

    // Bob is taken off the list; his session and tokens are still around.
    const later = app(ALLOWED);
    const authorize = await target(
      await later.call(authorizePath(clientId, pkce().challenge), {
        headers: { cookie: bob, ...browser },
      }),
    );
    expect(authorize).toBe("/connect/closed?reason=private");

    const adasConsentPage = await target(
      await later.call(authorizePath(clientId, pkce().challenge), {
        headers: { cookie: ada, ...browser },
      }),
    );
    const consent = await later.call("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob, origin: ORIGIN },
      body: JSON.stringify({
        accept: true,
        oauth_query: adasConsentPage.slice("/connect?".length),
      }),
    });
    expect(consent.status).toBe(403);

    const call = await listTools(later.mcp, bobsTokens.access_token);
    expect(call.status).toBe(403);
  });
});
