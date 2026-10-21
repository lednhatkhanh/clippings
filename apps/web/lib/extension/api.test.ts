import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizePath as authorizePathFor,
  browserHeaders as browser,
  connect as connectWith,
  pkce,
  registeredClientId,
  registerClient,
  serveAuth,
  signIn as signInUser,
  target,
} from "@/lib/auth/testing.ts";
import { createMcpRoute } from "@/lib/mcp/handler.ts";
import { mcpResourceUrl } from "@/lib/mcp/resource.ts";
import {
  createConnectionsService,
  createPool,
  createSettingsService,
  systemClock,
  type ConnectionsService,
} from "@clippings/db";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";
import {
  CLIPPINGS_EXTENSION_ID,
  MAX_TITLE_LENGTH,
  type ExtensionSaveResponse,
} from "@clippings/shared";

import { createExtensionApi } from "./api.ts";
import { extensionOrigin, extensionRedirectUri, extensionResourceUrl } from "./origins.ts";

const EXTENSION_ORIGIN = extensionOrigin(CLIPPINGS_EXTENSION_ID);
const REDIRECT_URI = extensionRedirectUri(CLIPPINGS_EXTENSION_ID);
const ALLOWED = "ada@example.com";

describe.skipIf(!TEST_DATABASE_URL)("the extension signing in and calling its API", () => {
  let fixture: ServiceFixture;
  let pool: ReturnType<typeof createPool>;
  // Each test's database signs with its own keys, and the verifier caches keys by their URL: a
  // port per test keeps one test from verifying with another's.
  let port = 4000;
  let appOrigin: string;
  let apiResource: string;
  // On the real clock: a revocation must land after the tokens' `iat`, which the fixture's
  // fixed clock doesn't.
  let connections: ConnectionsService;

  /** The app's auth and extension API with this allowlist, on the test database. */
  function app(allowedEmails: string) {
    const { auth, call } = serveAuth({
      pool,
      origin: appOrigin,
      allowedEmails,
      extensionIds: [CLIPPINGS_EXTENSION_ID],
    });
    const api = createExtensionApi({
      auth,
      clippings: fixture.service,
      settings: createSettingsService({ pool, clock: systemClock }),
      connections,
      resource: apiResource,
      allowedEmails,
      extensionIds: [CLIPPINGS_EXTENSION_ID],
    });
    return { auth, api, call };
  }

  const signIn = (id: string, email: string) => signInUser(pool, id, email);

  /** Registers as the extension's service worker does, for its API's resource. */
  async function register(call: ReturnType<typeof app>["call"]) {
    const response = await registerClient(
      call,
      {
        client_name: "Clippings for Chrome",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        resources: [apiResource],
      },
      { origin: EXTENSION_ORIGIN },
    );
    expect(response.status).toBe(201);
    return registeredClientId(response);
  }

  function authorizePath(
    clientId: string,
    challenge: string,
    resources: readonly string[] = [apiResource],
    redirectUri = REDIRECT_URI,
  ) {
    return authorizePathFor({
      clientId,
      challenge,
      redirectUri,
      resources,
      scope: "offline_access",
    });
  }

  /** Signs in as the extension does: authorize, allow on the consent page, trade the code. */
  async function connect(
    setup: ReturnType<typeof app>,
    cookie: string,
    resources: readonly string[] = [apiResource],
  ) {
    const clientId = await register(setup.call);
    return connectWith(
      setup.call,
      cookie,
      appOrigin,
      { clientId, redirectUri: REDIRECT_URI, resources, scope: "offline_access" },
      { origin: EXTENSION_ORIGIN },
    );
  }

  function save(api: ReturnType<typeof app>["api"], url: string, accessToken?: string) {
    return api.save(
      new Request(`${apiResource}/clippings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: EXTENSION_ORIGIN,
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ url }),
      }),
    );
  }

  function lookup(api: ReturnType<typeof app>["api"], url: string, accessToken: string) {
    return api.lookup(
      new Request(`${apiResource}/lookup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: EXTENSION_ORIGIN,
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ url }),
      }),
    );
  }

  function update(
    api: ReturnType<typeof app>["api"],
    id: string,
    changes: { title?: string | null; note?: string; tags?: string[] },
    accessToken: string,
  ) {
    return api.update(
      new Request(`${apiResource}/clippings/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: EXTENSION_ORIGIN,
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(changes),
      }),
      id,
    );
  }

  const updateNote = (
    api: ReturnType<typeof app>["api"],
    id: string,
    note: string,
    accessToken: string,
  ) => update(api, id, { note }, accessToken);

  /** A GET the popup sends, such as for the user's tags or settings. */
  const get = (path: string, accessToken: string) =>
    new Request(`${apiResource}${path}`, {
      headers: { origin: EXTENSION_ORIGIN, authorization: `Bearer ${accessToken}` },
    });

  beforeEach(async () => {
    port += 1;
    appOrigin = `http://localhost:${port}`;
    apiResource = extensionResourceUrl(appOrigin);
    fixture = await createServiceFixture();
    pool = createPool(fixture.databaseUrl);
    connections = createConnectionsService({ pool, clock: systemClock });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await pool.end();
    await fixture.close();
  });

  it("answers the extension's CORS preflight, and no one else's", () => {
    const { api } = app(ALLOWED);
    const preflight = (origin: string) =>
      api.preflight(
        new Request(`${apiResource}/clippings`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization, content-type",
          },
        }),
      );

    const ours = preflight(EXTENSION_ORIGIN);
    expect(ours.status).toBe(204);
    expect(ours.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    expect(ours.headers.get("access-control-allow-methods")).toBe("GET, POST, PATCH");
    expect(ours.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    // A bearer token, never cookies.
    expect(ours.headers.get("access-control-allow-credentials")).toBeNull();

    for (const origin of ["https://evil.example", extensionOrigin("a".repeat(32)), appOrigin]) {
      const theirs = preflight(origin);
      expect(theirs.status).toBe(403);
      expect(theirs.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("challenges a call without a token, and ignores a session cookie", async () => {
    const setup = app(ALLOWED);
    const cookie = await signIn("ada", ALLOWED);

    const response = await setup.api.save(
      new Request(`${apiResource}/clippings`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: EXTENSION_ORIGIN, cookie },
        body: JSON.stringify({ url: "https://example.com/a" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
  });

  it("signs in with PKCE, saves with source extension, then finds the same page", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED));
    expect(tokens.refresh_token).toBeTruthy();

    const first = await save(setup.api, "https://example.com/a?utm_source=x", tokens.access_token);
    expect(first.status).toBe(201);
    expect(first.headers.get("set-cookie")).toBeNull();
    const created = (await first.json()) as ExtensionSaveResponse;
    expect(created.status).toBe("created");
    expect(created.clipping.link).toBe(`${appOrigin}/c/${created.clipping.id}`);

    const stored = await fixture.service.getClipping("ada", created.clipping.id);
    expect(stored).toMatchObject({ source: "extension", clientId: tokens.clientId });

    const noted = await updateNote(setup.api, created.clipping.id, "Worth it", tokens.access_token);
    expect(noted.status).toBe(200);

    const again = await save(setup.api, "https://example.com/a", tokens.access_token);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      status: "existing",
      clipping: {
        id: created.clipping.id,
        note: "Worth it",
        createdAt: created.clipping.createdAt,
      },
    });
  });

  it("renames a clipping, goes back to the page's title, and refuses a title that is too long", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED));
    const created = (await (
      await save(setup.api, "https://example.com/a", tokens.access_token)
    ).json()) as ExtensionSaveResponse;
    const pageTitle = created.clipping.title;

    const renamed = await update(
      setup.api,
      created.clipping.id,
      { title: "  My name for it " },
      tokens.access_token,
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      id: created.clipping.id,
      title: "My name for it",
    });
    expect(await fixture.service.getClipping("ada", created.clipping.id)).toMatchObject({
      title: "My name for it",
      titleEdited: true,
      pageTitle,
    });

    for (const title of [null, ""]) {
      await update(setup.api, created.clipping.id, { title: "Again" }, tokens.access_token);
      const reset = await update(setup.api, created.clipping.id, { title }, tokens.access_token);
      expect(reset.status).toBe(200);
      expect(await reset.json()).toMatchObject({ title: pageTitle });
    }

    const long = await update(
      setup.api,
      created.clipping.id,
      { title: "x".repeat(MAX_TITLE_LENGTH + 1) },
      tokens.access_token,
    );
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "invalid_request" });
  });

  it("says whether the caller saved a page, and nothing more", async () => {
    const setup = app(`${ALLOWED} bob@example.com`);
    const ada = await connect(setup, await signIn("ada", ALLOWED));
    const bob = await connect(setup, await signIn("bob", "bob@example.com"));
    expect((await save(setup.api, "https://example.com/a", ada.access_token)).status).toBe(201);

    const saved = await lookup(setup.api, "https://example.com/a/?utm_source=x", ada.access_token);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    expect(await saved.json()).toEqual({ saved: true });

    const other = await lookup(setup.api, "https://example.com/b", ada.access_token);
    expect(await other.json()).toEqual({ saved: false });
    const notBobs = await lookup(setup.api, "https://example.com/a", bob.access_token);
    expect(await notBobs.json()).toEqual({ saved: false });

    const unsigned = await setup.api.lookup(
      new Request(`${apiResource}/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: EXTENSION_ORIGIN },
        body: JSON.stringify({ url: "https://example.com/a" }),
      }),
    );
    expect(unsigned.status).toBe(401);
    expect((await lookup(setup.api, "", ada.access_token)).status).toBe(400);
  });

  it("sets tags by name, creating new ones, and lists them for the picker", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED));
    // A tag the user made in the web app, on another clipping.
    const other = await fixture.service.saveClipping("ada", {
      url: "https://example.com/b",
      source: "web",
      tags: ["Reading"],
    });
    const [existing] = other.clipping.tags;

    const saved = (await (
      await save(setup.api, "https://example.com/a", tokens.access_token)
    ).json()) as ExtensionSaveResponse;
    expect(saved.clipping.tags).toEqual([]);

    const tagged = await update(
      setup.api,
      saved.clipping.id,
      { tags: ["reading", " New  idea "] },
      tokens.access_token,
    );
    expect(tagged.status).toBe(200);
    const body = (await tagged.json()) as ExtensionSaveResponse["clipping"];
    expect(body.tags.map((tag) => tag.name).sort()).toEqual(["New idea", "Reading"]);
    expect(body.tags.find((tag) => tag.name === "Reading")?.id).toBe(existing?.id);

    // What the web app shows for the clipping.
    const stored = await fixture.service.getClipping("ada", saved.clipping.id);
    expect(stored?.tags.map((tag) => tag.name).sort()).toEqual(["New idea", "Reading"]);
    expect(stored?.note).toBe("");

    const reopened = (await (
      await save(setup.api, "https://example.com/a", tokens.access_token)
    ).json()) as ExtensionSaveResponse;
    expect(reopened.clipping.tags.map((tag) => tag.name).sort()).toEqual(["New idea", "Reading"]);

    const listed = await setup.api.listTags(get("/tags", tokens.access_token));
    expect(listed.status).toBe(200);
    expect(listed.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
    expect(((await listed.json()) as { name: string }[]).map((tag) => tag.name).sort()).toEqual([
      "New idea",
      "Reading",
    ]);

    const cleared = await update(setup.api, saved.clipping.id, { tags: [] }, tokens.access_token);
    expect(((await cleared.json()) as ExtensionSaveResponse["clipping"]).tags).toEqual([]);
  });

  it("answers the user's palette, the default until they choose one", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED));

    const before = await setup.api.settings(get("/settings", tokens.access_token));
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ palette: "olive" });

    await createSettingsService({ pool, clock: systemClock }).updateSettings("ada", {
      palette: "ink",
      theme: "dark",
    });
    const after = await setup.api.settings(get("/settings", tokens.access_token));
    expect(await after.json()).toEqual({ palette: "ink" });

    const signedOut = await setup.api.settings(
      new Request(`${apiResource}/settings`, { headers: { origin: EXTENSION_ORIGIN } }),
    );
    expect(signedOut.status).toBe(401);
  });

  it("refuses the extension's tokens once the user revokes it in Settings", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED));
    expect((await save(setup.api, "https://example.com/a", tokens.access_token)).status).toBe(201);

    // `iat` is whole seconds: revoke in a later second than the token was issued.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await connections.revokeConnection("ada", tokens.clientId)).toBe(true);

    const refused = await save(setup.api, "https://example.com/b", tokens.access_token);
    expect(refused.status).toBe(401);
  });

  it("keeps each user to their own clippings", async () => {
    const setup = app(`${ALLOWED} bob@example.com`);
    const ada = await connect(setup, await signIn("ada", ALLOWED));
    const bob = await connect(setup, await signIn("bob", "bob@example.com"));

    const adas = (await (
      await save(setup.api, "https://example.com/a", ada.access_token)
    ).json()) as ExtensionSaveResponse;
    const response = await updateNote(setup.api, adas.clipping.id, "Mine now", bob.access_token);

    expect(response.status).toBe(404);
    expect((await fixture.service.getClipping("ada", adas.clipping.id))?.note).toBe("");

    const tagged = await update(setup.api, adas.clipping.id, { tags: ["Bob's"] }, bob.access_token);
    expect(tagged.status).toBe(404);
    expect((await fixture.service.getClipping("ada", adas.clipping.id))?.tags).toEqual([]);
    await update(setup.api, adas.clipping.id, { tags: ["Ada's"] }, ada.access_token);
    const bobs = await setup.api.listTags(get("/tags", bob.access_token));
    expect(await bobs.json()).toEqual([]);
  });

  it("refuses bad input", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED));

    const notAPage = await save(setup.api, "chrome://extensions", tokens.access_token);
    expect(notAPage.status).toBe(400);
    expect(await notAPage.json()).toEqual({ error: "invalid_url" });

    const saved = (await (
      await save(setup.api, "https://example.com/a", tokens.access_token)
    ).json()) as ExtensionSaveResponse;
    const long = await updateNote(
      setup.api,
      saved.clipping.id,
      "x".repeat(10_001),
      tokens.access_token,
    );
    expect(long.status).toBe(400);

    for (const changes of [
      {},
      { tags: ["x".repeat(51)] },
      { tags: Array.from({ length: 21 }, (_, index) => `tag ${index}`) },
    ]) {
      const refused = await update(setup.api, saved.clipping.id, changes, tokens.access_token);
      expect(refused.status).toBe(400);
    }
  });

  it("refuses a token issued for /mcp", async () => {
    const setup = app(ALLOWED);
    const mcpTokens = await connect(setup, await signIn("ada", ALLOWED), [
      mcpResourceUrl(appOrigin),
    ]);

    const response = await save(setup.api, "https://example.com/a", mcpTokens.access_token);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
  });

  it("refuses a token issued for both /mcp and the extension API", async () => {
    const setup = app(ALLOWED);
    const both = await connect(setup, await signIn("ada", ALLOWED), [
      apiResource,
      mcpResourceUrl(appOrigin),
    ]);

    const response = await save(setup.api, "https://example.com/a", both.access_token);
    expect(response.status).toBe(401);
  });

  it("is refused at /mcp with an extension token", async () => {
    const setup = app(ALLOWED);
    const tokens = await connect(setup, await signIn("ada", ALLOWED));
    const mcp = createMcpRoute({
      auth: setup.auth,
      clippings: fixture.service,
      connections,
      resource: mcpResourceUrl(appOrigin),
      allowedEmails: ALLOWED,
    });

    const response = await mcp(
      new Request(mcpResourceUrl(appOrigin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${tokens.access_token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("keeps the extension API's resource to the extension", async () => {
    const setup = app(ALLOWED);
    const loopback = "http://127.0.0.1:43210/callback";
    const registerFor = (redirectUris: string[], resources?: string[]) =>
      setup.call("/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude Code",
          redirect_uris: redirectUris,
          token_endpoint_auth_method: "none",
          ...(resources ? { resources } : {}),
        }),
      });

    // A client that returns elsewhere can't register for the resource...
    const refused = await registerFor([loopback], [apiResource]);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_target" });
    expect((await registerFor([REDIRECT_URI, loopback], [apiResource])).status).toBe(400);

    // ...nor ask for it when it authorizes.
    const registered = await registerFor([loopback]);
    const { client_id: clientId } = (await registered.json()) as { client_id: string };
    const cookie = await signIn("ada", ALLOWED);
    const authorize = await setup.call(
      authorizePath(clientId, pkce().challenge, [apiResource], loopback),
      { headers: { cookie, ...browser } },
    );
    expect(authorize.status).toBe(400);
  });

  it("refuses an account taken off the allowlist, and sends its sign-in back to the extension", async () => {
    const setup = app(`${ALLOWED} bob@example.com`);
    const bob = await signIn("bob", "bob@example.com");
    const tokens = await connect(setup, bob);

    // Bob is taken off the list; his session and tokens are still around.
    const later = app(ALLOWED);
    const response = await save(later.api, "https://example.com/a", tokens.access_token);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_allowlisted" });

    const clientId = await register(later.call);
    const authorize = new URL(
      await target(
        await later.call(authorizePath(clientId, pkce().challenge), {
          headers: { cookie: bob, ...browser },
        }),
      ),
    );
    expect(`${authorize.origin}/`).toBe(REDIRECT_URI);
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      error: "access_denied",
      error_description: "not_allowlisted",
      state: "state-1",
    });
  });
});
