import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { addDays, constructNow } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorize as authorizeWith,
  consentQuery,
  authorizePath as authorizePathFor,
  browserHeaders as browser,
  consent as consentWith,
  connect as connectWith,
  exchange as exchangeWith,
  pkce,
  refreshTokens,
  registeredClientId,
  registerClient,
  serveAuth,
  signIn as signInUser,
  target,
} from "@/lib/auth/testing.ts";
import { createConnectionsService, createPool, systemClock } from "@clippings/db";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

import { createMcpRoute } from "./handler.ts";
import { mcpResourceUrl } from "./resource.ts";
import { WRITE_SCOPE } from "./scopes.ts";

const REDIRECT_URI = "http://127.0.0.1:43210/callback";
// Another loopback port than the registered one, as Claude Code picks a free port.
const CALLBACK_URI = "http://127.0.0.1:51234/callback";
const ALLOWED = "ada@example.com";

/** The text of a tool result's first content block. */
function toolText(result: { content?: unknown }): string {
  const [block] = (result.content ?? []) as { type: string; text?: string }[];
  return block?.text ?? "";
}

describe.skipIf(!TEST_DATABASE_URL)("connecting a client and calling /mcp", () => {
  let fixture: ServiceFixture;
  let pool: ReturnType<typeof createPool>;
  // A port per test: the token verifier caches signing keys by URL, refetching a missing key at
  // most every few seconds, and every test's database signs with a new key.
  let port = 3999;
  let ORIGIN: string;
  let RESOURCE: string;

  /** The app's auth and `/mcp` route with this allowlist, on the test database. */
  function app(allowedEmails: string) {
    const { auth, call } = serveAuth({ pool, origin: ORIGIN, allowedEmails });
    const connections = createConnectionsService({ pool, clock: systemClock });
    const mcp = createMcpRoute({
      auth,
      clippings: fixture.service,
      connections,
      resource: RESOURCE,
      allowedEmails,
    });
    return { auth, mcp, call, connections };
  }

  const signIn = (id: string, email: string) => signInUser(pool, id, email);

  async function register(call: ReturnType<typeof app>["call"], name = "Claude Code") {
    return registeredClientId(
      await registerClient(call, { client_name: name, redirect_uris: [REDIRECT_URI] }),
    );
  }

  function authorizePath(clientId: string, challenge: string, prompt?: string) {
    return authorizePathFor({
      clientId,
      challenge,
      redirectUri: CALLBACK_URI,
      resources: [RESOURCE],
      prompt,
    });
  }

  const flow = (clientId: string) => ({
    clientId,
    redirectUri: CALLBACK_URI,
    resources: [RESOURCE],
  });

  /** Authorizes as the signed-in user and allows on the consent page; returns the code. */
  const authorize = (setup: ReturnType<typeof app>, cookie: string, clientId: string) =>
    authorizeWith(setup.call, cookie, ORIGIN, flow(clientId));

  const exchange = (
    setup: ReturnType<typeof app>,
    authorization: Awaited<ReturnType<typeof authorize>>,
  ) => exchangeWith(setup.call, authorization);

  /** Authorizes as the signed-in user, allows on the consent page, and trades the code. */
  async function connect(setup: ReturnType<typeof app>, cookie: string, clientId: string) {
    const tokens = await connectWith(setup.call, cookie, ORIGIN, flow(clientId));
    return { ...tokens, refresh_token: tokens.refresh_token ?? "" };
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
    ORIGIN = `http://localhost:${port--}`;
    RESOURCE = mcpResourceUrl(ORIGIN);
    fixture = await createServiceFixture();
    pool = createPool(fixture.databaseUrl);
  });

  afterEach(async () => {
    vi.useRealTimers();
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

    const response = await listTools(setup.mcp, tokens.access_token);
    expect(response.status).toBe(200);

    // The refresh token rotates: a refresh returns a new pair, and the new access token works.
    const refreshed = await refresh(setup.call, tokens);
    expect(refreshed.status).toBe(200);
    const rotated = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    expect((await listTools(setup.mcp, rotated.access_token)).status).toBe(200);
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
    const consent = await consentWith(later.call, {
      cookie: bob,
      origin: ORIGIN,
      query: adasConsentPage.slice("/connect?".length),
    });
    expect(consent.status).toBe(403);

    const call = await listTools(later.mcp, bobsTokens.access_token);
    expect(call.status).toBe(403);
  });

  const refresh = (
    call: ReturnType<typeof app>["call"],
    tokens: { refresh_token: string; clientId: string },
  ) =>
    refreshTokens(call, {
      refreshToken: tokens.refresh_token,
      clientId: tokens.clientId,
      resources: [RESOURCE],
    });

  it("lists the connected clients with their last use", async () => {
    const setup = app(ALLOWED);
    const cookie = await signIn("ada", ALLOWED);
    const code = await connect(setup, cookie, await register(setup.call, "Claude Code"));
    await connect(setup, cookie, await register(setup.call, "Clippings extension"));

    expect((await listTools(setup.mcp, code.access_token)).status).toBe(200);

    // Most recently used first: the call just now beats the other client's token issue.
    const connections = await setup.connections.listConnections("ada");
    expect(connections.map((connection) => connection.name)).toEqual([
      "Claude Code",
      "Clippings extension",
    ]);
    expect(connections[0]!.lastUsedAt).not.toBeNull();
  });

  it("revokes one client: its next call gets 401, and the other keeps working", async () => {
    const setup = app(ALLOWED);
    const cookie = await signIn("ada", ALLOWED);
    const code = await connect(setup, cookie, await register(setup.call, "Claude Code"));
    const extension = await connect(setup, cookie, await register(setup.call, "Extension"));
    expect((await listTools(setup.mcp, code.access_token)).status).toBe(200);

    // `iat` is whole seconds: revoke in a later second than the tokens were issued.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await setup.connections.revokeConnection("ada", code.clientId)).toBe(true);

    const refused = await listTools(setup.mcp, code.access_token);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect((await refresh(setup.call, code)).status).toBe(400);

    expect((await listTools(setup.mcp, extension.access_token)).status).toBe(200);
    expect((await refresh(setup.call, extension)).status).toBe(200);
    expect(
      (await setup.connections.listConnections("ada")).map((connection) => connection.clientId),
    ).toEqual([extension.clientId]);

    // Connecting again works with the new tokens.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const again = await connect(setup, cookie, code.clientId);
    expect((await listTools(setup.mcp, again.access_token)).status).toBe(200);
  });

  it("revoking for one user leaves another user's connection to the same client working", async () => {
    const setup = app(`${ALLOWED} bob@example.com`);
    const ada = await signIn("ada", ALLOWED);
    const bob = await signIn("bob", "bob@example.com");
    const clientId = await register(setup.call);
    const adas = await connect(setup, ada, clientId);
    const bobs = await connect(setup, bob, clientId);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await setup.connections.revokeConnection("ada", clientId);

    expect((await listTools(setup.mcp, adas.access_token)).status).toBe(401);
    expect((await listTools(setup.mcp, bobs.access_token)).status).toBe(200);
    expect(await setup.connections.listConnections("bob")).toHaveLength(1);
  });

  it("refuses a code issued before the client was revoked", async () => {
    const setup = app(ALLOWED);
    const cookie = await signIn("ada", ALLOWED);
    const clientId = await register(setup.call);
    await connect(setup, cookie, clientId);
    const pending = await authorize(setup, cookie, clientId);

    await setup.connections.revokeConnection("ada", clientId);

    expect((await exchange(setup, pending)).status).toBe(400);
  });

  /** A POST to `/mcp` with this raw body and (unless `null`) this token. */
  function post(mcp: ReturnType<typeof app>["mcp"], body: string, accessToken: string | null) {
    return mcp(
      new Request(RESOURCE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body,
      }),
    );
  }

  it("refuses an expired access token, with the challenge that makes the client sign in again", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED), await register(setup.call));
    expect((await listTools(setup.mcp, tokens.access_token)).status).toBe(200);

    // Access tokens live an hour and nothing stores them: only the clock ages one.
    vi.useFakeTimers({ toFake: ["Date"], now: addDays(constructNow(undefined), 1) });
    const refused = await listTools(setup.mcp, tokens.access_token);

    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("refuses an access token whose claims were changed after it was signed", async () => {
    const setup = app(`${ALLOWED} bob@example.com`);
    await signIn("bob", "bob@example.com");
    const tokens = await connect(setup, await signIn("ada", ALLOWED), await register(setup.call));

    // Ada's token, now naming Bob as the user, with Ada's signature.
    const [header, payload, signature] = tokens.access_token.split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub: string };
    expect(claims.sub).toBe("ada");
    const forged = [
      header,
      Buffer.from(JSON.stringify({ ...claims, sub: "bob" })).toString("base64url"),
      signature,
    ].join(".");

    const refused = await listTools(setup.mcp, forged);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("answers GET and DELETE with 405 once authenticated, and challenges before that", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED), await register(setup.call));
    const send = (method: string, accessToken?: string) =>
      setup.mcp(
        new Request(RESOURCE, {
          method,
          headers: {
            accept: "application/json, text/event-stream",
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
        }),
      );

    // Stateless: there is no stream to open and no session to end.
    for (const method of ["GET", "DELETE"]) {
      const answered = await send(method, tokens.access_token);
      expect(answered.status).toBe(405);
      expect(await answered.json()).toMatchObject({ error: { message: "Method not allowed." } });

      expect((await send(method)).status).toBe(401);
    }
  });

  it("answers malformed JSON-RPC with a JSON-RPC error, not a server error", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED), await register(setup.call));

    const parse = await post(setup.mcp, "{not json", tokens.access_token);
    expect(parse.status).toBe(400);
    expect(await parse.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32_700 } });

    // Valid JSON that isn't a request, and an empty batch.
    for (const body of ['{"foo":1}', "[]"]) {
      const invalid = await post(setup.mcp, body, tokens.access_token);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32_600 } });
    }

    // An unknown method is a JSON-RPC error inside a 200 reply.
    const unknown = await post(
      setup.mcp,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nope" }),
      tokens.access_token,
    );
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toContain('"code":-32601');
  });

  describe("write access", () => {
    const READ_TOOLS = ["list_recent", "save_clipping", "search_clippings"];
    const WRITE_TOOLS = [
      "delete_clipping",
      "get_clipping",
      "get_page_text",
      "list_tags",
      "restore_clipping",
      "update_clipping",
    ];

    /** The names `tools/list` answered with. */
    async function toolNames(response: Response) {
      expect(response.status).toBe(200);
      const body = await response.text();
      const json = body.startsWith("{") ? body : (body.match(/^data: (.*)$/m)?.[1] ?? "");
      const { result } = JSON.parse(json) as { result: { tools: { name: string }[] } };
      return result.tools.map((tool) => tool.name).sort();
    }

    const scopeOf = (accessToken: string) =>
      (
        JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString()) as {
          scope: string;
        }
      ).scope.split(" ");

    it("advertises the write scope in the protected resource metadata", async () => {
      const { call } = app(ALLOWED);
      const metadata = (await (await call("/.well-known/oauth-protected-resource/mcp")).json()) as {
        scopes_supported: string[];
      };
      expect(metadata.scopes_supported).toEqual([WRITE_SCOPE]);
    });

    it("gives a client that asks for no scope the defaults, not write access", async () => {
      const setup = app(ALLOWED);
      const cookie = await signIn("ada", ALLOWED);
      const clientId = await register(setup.call);

      // The consent page is told what is being granted.
      const query = new URLSearchParams(await consentQuery(setup.call, cookie, flow(clientId)));
      expect(query.get("scope")?.split(" ").sort()).toEqual([
        "email",
        "offline_access",
        "openid",
        "profile",
      ]);

      const tokens = await connect(setup, cookie, clientId);
      expect(scopeOf(tokens.access_token)).not.toContain(WRITE_SCOPE);
      expect(await toolNames(await listTools(setup.mcp, tokens.access_token))).toEqual(READ_TOOLS);

      // Refreshing keeps what was granted.
      const refreshed = (await (await refresh(setup.call, tokens)).json()) as {
        access_token: string;
      };
      expect(await toolNames(await listTools(setup.mcp, refreshed.access_token))).toEqual(
        READ_TOOLS,
      );
    });

    it("gives a client that asks for no scope the defaults when it authorizes with a POST", async () => {
      const setup = app(ALLOWED);
      const cookie = await signIn("ada", ALLOWED);
      const [path, form] = authorizePath(await register(setup.call), pkce().challenge).split("?");

      const response = await setup.call(path!, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie, ...browser },
        body: form,
      });
      const page = await target(response);
      expect(page).toMatch(/^\/connect\?/);
      const query = new URLSearchParams(page.slice("/connect?".length));
      expect(query.get("scope")?.split(" ").sort()).toEqual([
        "email",
        "offline_access",
        "openid",
        "profile",
      ]);
      // Every authorization asks, also one that came as a POST.
      expect(query.get("prompt")).toContain("consent");
    });

    it("gives a client that asks for write access only the read tools when the user allows read-only", async () => {
      const setup = app(ALLOWED);
      const request = {
        ...flow(await register(setup.call)),
        scope: `openid offline_access ${WRITE_SCOPE}`,
      };
      const tokens = await connectWith(
        setup.call,
        await signIn("ada", ALLOWED),
        ORIGIN,
        request,
        {},
        "openid offline_access",
      );

      expect(scopeOf(tokens.access_token)).not.toContain(WRITE_SCOPE);
      expect(await toolNames(await listTools(setup.mcp, tokens.access_token))).toEqual(READ_TOOLS);

      // Refreshing keeps what was granted.
      const refreshed = (await (
        await refresh(setup.call, { ...tokens, refresh_token: tokens.refresh_token ?? "" })
      ).json()) as { access_token: string };
      expect(scopeOf(refreshed.access_token)).not.toContain(WRITE_SCOPE);
    });

    it("refuses a consent for a scope the client did not ask for", async () => {
      const setup = app(ALLOWED);
      const cookie = await signIn("ada", ALLOWED);
      const query = await consentQuery(setup.call, cookie, {
        ...flow(await register(setup.call)),
        scope: "openid",
      });

      const response = await consentWith(setup.call, {
        cookie,
        origin: ORIGIN,
        query,
        scope: `openid ${WRITE_SCOPE}`,
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("gives a client that asks for read scopes only the read tools", async () => {
      const setup = app(ALLOWED);
      const tokens = await connectWith(setup.call, await signIn("ada", ALLOWED), ORIGIN, {
        ...flow(await register(setup.call)),
        scope: "openid offline_access",
      });

      expect(await toolNames(await listTools(setup.mcp, tokens.access_token))).toEqual(READ_TOOLS);
    });

    it("offers the write tools to a client that asked for the write scope, and they work", async () => {
      const setup = app(`${ALLOWED} bob@example.com`);
      const ada = await signIn("ada", ALLOWED);
      await signIn("bob", "bob@example.com");
      const tokens = await connectWith(setup.call, ada, ORIGIN, {
        ...flow(await register(setup.call)),
        scope: `openid offline_access ${WRITE_SCOPE}`,
      });
      expect(scopeOf(tokens.access_token)).toContain(WRITE_SCOPE);
      const bobsClipping = (
        await fixture.service.saveClipping("bob", { url: "https://example.com/bob", source: "web" })
      ).clipping;

      const client = new Client({ name: "write-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
        fetch: (input, init) => {
          const request = new Request(input, init);
          request.headers.set("authorization", `Bearer ${tokens.access_token}`);
          return setup.mcp(request);
        },
      });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual(
          [...READ_TOOLS, ...WRITE_TOOLS].sort(),
        );

        const saved = await client.callTool({
          name: "save_clipping",
          arguments: { url: "https://example.com/otters" },
        });
        const { clipping } = JSON.parse(toolText(saved)) as { clipping: { id: string } };

        const updated = await client.callTool({
          name: "update_clipping",
          arguments: { id: clipping.id, title: "Otters", note: "swim", tags: ["animals"] },
        });
        expect(updated.isError).toBeFalsy();
        expect(await fixture.service.getClipping("ada", clipping.id)).toMatchObject({
          title: "Otters",
          note: "swim",
          tags: [{ name: "animals" }],
        });

        // Bob's clipping is out of reach.
        const foreign = await client.callTool({
          name: "delete_clipping",
          arguments: { id: bobsClipping.id },
        });
        expect(foreign.isError).toBe(true);
        expect(await fixture.service.getClipping("bob", bobsClipping.id)).not.toBeNull();
      } finally {
        await client.close();
      }
    });
  });

  it("serves the official MCP client over Streamable HTTP: connects, lists tools, saves and searches", async () => {
    const setup = app(`${ALLOWED} bob@example.com`);
    const ada = await signIn("ada", ALLOWED);
    await signIn("bob", "bob@example.com");
    const tokens = await connect(setup, ada, await register(setup.call));
    // Bob already saved a page that Ada's search would match.
    await fixture.service.saveClipping("bob", {
      url: "https://example.com/bobs-otters",
      note: "otter facts",
      source: "web",
    });

    // The client's requests go straight to the route handler, with Ada's token.
    const client = new Client({ name: "conformance-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
      fetch: (input, init) => {
        const request = new Request(input, init);
        request.headers.set("authorization", `Bearer ${tokens.access_token}`);
        return setup.mcp(request);
      },
    });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "list_recent",
        "save_clipping",
        "search_clippings",
      ]);

      const saved = await client.callTool({
        name: "save_clipping",
        arguments: { url: "https://example.com/otters", note: "otter research" },
      });
      expect(saved.isError).toBeFalsy();
      const created = JSON.parse(toolText(saved)) as {
        status: string;
        clipping: { id: string; url: string; source: string };
      };
      expect(created).toMatchObject({
        status: "created",
        clipping: { url: "https://example.com/otters", source: "mcp" },
      });

      const found = await client.callTool({
        name: "search_clippings",
        arguments: { query: "otter" },
      });
      const { clippings } = JSON.parse(toolText(found)) as { clippings: { id: string }[] };
      expect(clippings.map((clipping) => clipping.id)).toEqual([created.clipping.id]);

      // The clipping is Ada's and was saved by the client that connected.
      expect(await fixture.service.getClipping("ada", created.clipping.id)).toMatchObject({
        source: "mcp",
        clientId: tokens.clientId,
      });
      expect(await fixture.service.getClipping("bob", created.clipping.id)).toBeNull();
    } finally {
      await client.close();
    }
  });
});
