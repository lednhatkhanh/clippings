import { addSeconds, constructNow } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { formatIsoUtc } from "@clippings/shared";

import { accessToken, isSignedIn, signIn, signOut, takeSignInProblem } from "./auth.ts";

const REDIRECT = "https://test-extension-id.chromiumapp.org/";

interface Seen {
  path: string;
  body: URLSearchParams | Record<string, unknown>;
}

/**
 * A stand-in for the authorization server: it registers clients, issues tokens, and refuses a
 * refresh token it has already seen (they rotate), as the real one does. Its authorization
 * endpoint sends the extension's own redirect an `invalid_client` error for a client it doesn't
 * know, and approves a client it does; it never answers the sign-in window any other way.
 */
function authServer() {
  const requests: Seen[] = [];
  let issued = 0;
  const validRefreshTokens = new Set(["refresh-0"]);
  const server = {
    requests,
    /** Overrides the token endpoint's answer: an HTTP status, or a network failure. */
    tokenFailure: undefined as { status: number; error?: string } | "network" | undefined,
    revokeFails: false,
    clientIds: new Set<string>(),
    /** The address the sign-in window ends on for this authorization request. */
    authorize(url: string, state: string) {
      requests.push({ path: "/authorize", body: new URL(url).searchParams });
      const clientId = new URL(url).searchParams.get("client_id") ?? "";
      if (!server.clientIds.has(clientId)) {
        return callback({ error: "invalid_client", error_description: "unknown_client", state });
      }
      return callback({ code: "the-code", state });
    },
    count: (path: string) => requests.filter((request) => request.path === path).length,
  };

  const handle = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname.replace("/api/auth/oauth2", "");
    const sent = init?.body;
    const body =
      typeof sent === "string"
        ? (JSON.parse(sent) as Record<string, unknown>)
        : (sent as URLSearchParams);
    requests.push({ path, body });

    if (path === "/register") {
      const clientId = `client-${server.clientIds.size + 1}`;
      server.clientIds.add(clientId);
      return Response.json({ client_id: clientId });
    }
    if (path === "/revoke") {
      if (server.revokeFails) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 200 });
    }
    if (path === "/token") {
      const params = body as URLSearchParams;
      if (server.tokenFailure === "network") throw new TypeError("Failed to fetch");
      if (server.tokenFailure) {
        return Response.json(
          { error: server.tokenFailure.error ?? "invalid_grant" },
          { status: server.tokenFailure.status },
        );
      }
      if (params.get("grant_type") === "refresh_token") {
        const token = params.get("refresh_token") ?? "";
        if (!validRefreshTokens.delete(token)) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
      }
      issued += 1;
      validRefreshTokens.add(`refresh-${issued}`);
      return Response.json({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
        expires_in: 3600,
      });
    }
    return new Response(null, { status: 404 });
  };
  vi.stubGlobal("fetch", vi.fn(handle));
  return server;
}

/** The address the authorization server sends the browser back to. */
function callback(params: Record<string, string>) {
  return `${REDIRECT}?${new URLSearchParams(params)}`;
}

/** Makes the sign-in window end with `answer`, given the state the request carried and its URL. */
function windowEnds(answer: (state: string, url: string) => string | Error) {
  vi.spyOn(browser.identity, "getRedirectURL").mockReturnValue(REDIRECT);
  vi.spyOn(browser.identity, "launchWebAuthFlow").mockImplementation((async (details: {
    url: string;
  }) => {
    const result = answer(new URL(details.url).searchParams.get("state") ?? "", details.url);
    if (result instanceof Error) throw result;
    return result;
  }) as never);
}

/** The window ends as the server's authorization endpoint decides. */
const authorizedBy = (server: ReturnType<typeof authServer>) =>
  windowEnds((state, url) => server.authorize(url, state));

const stored = async () =>
  (await browser.storage.local.get(["clientId", "tokens"])) as {
    clientId?: string;
    tokens?: { accessToken: string; refreshToken: string; expiresAt: string };
  };

function signedInWith(expiresInSeconds: number, refreshToken = "refresh-0") {
  return browser.storage.local.set({
    clientId: "client-1",
    tokens: {
      accessToken: "access-old",
      refreshToken,
      expiresAt: formatIsoUtc(addSeconds(constructNow(undefined), expiresInSeconds)),
    },
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("signing in", () => {
  it("registers the install, trades the code for tokens and keeps them", async () => {
    const server = authServer();
    authorizedBy(server);

    expect(await signIn()).toBe(true);

    expect(await isSignedIn()).toBe(true);
    expect(await stored()).toMatchObject({
      clientId: "client-1",
      tokens: { accessToken: "access-1", refreshToken: "refresh-1" },
    });
    expect(await takeSignInProblem()).toBeNull();
  });

  it("refuses an answer whose state isn't the one it sent", async () => {
    const server = authServer();
    windowEnds(() => callback({ code: "forged", state: "someone-elses" }));

    expect(await signIn()).toBe(false);

    expect(await isSignedIn()).toBe(false);
    expect(server.count("/token")).toBe(0);
    expect(await takeSignInProblem()).toBe("failed");
  });

  it.each([
    ["not_allowlisted", "not_allowlisted"],
    ["denied", "denied"],
    ["server_error", "failed"],
    [undefined, "failed"],
  ])("tells the popup an error described as %s is %s", async (description, problem) => {
    authServer();
    windowEnds((state) =>
      callback({
        error: "access_denied",
        state,
        ...(description ? { error_description: description } : {}),
      }),
    );

    expect(await signIn()).toBe(false);

    expect(await isSignedIn()).toBe(false);
    expect(await takeSignInProblem()).toBe(problem);
  });

  it("tells the popup why once", async () => {
    authServer();
    windowEnds((state) => callback({ error: "access_denied", error_description: "denied", state }));
    await signIn();

    expect(await takeSignInProblem()).toBe("denied");
    expect(await takeSignInProblem()).toBeNull();
  });

  it("keeps this install's OAuth client when the window is closed, so no client is registered twice", async () => {
    const server = authServer();
    windowEnds(() => new Error("The user did not approve access."));

    expect(await signIn()).toBe(false);
    expect(await takeSignInProblem()).toBe("cancelled");
    expect(await signIn()).toBe(false);

    expect(server.count("/register")).toBe(1);
    expect((await stored()).clientId).toBe("client-1");

    authorizedBy(server);
    expect(await signIn()).toBe(true);
    expect(server.count("/register")).toBe(1);
    expect((await stored()).tokens?.accessToken).toBe("access-1");
  });

  // After a database restore or a reset of the database branch, or with a build pointed at another
  // origin, the stored client is one the server never heard of. Its authorization endpoint then
  // never lets the window reach the token endpoint: it sends the extension an error instead.
  it("registers a new client and signs in when the server doesn't know the stored one", async () => {
    const server = authServer();
    authorizedBy(server);
    await browser.storage.local.set({ clientId: "client-forgotten" });

    expect(await signIn()).toBe(true);

    expect(server.count("/register")).toBe(1);
    expect(await stored()).toMatchObject({
      clientId: "client-1",
      tokens: { accessToken: "access-1" },
    });
    expect(await takeSignInProblem()).toBeNull();
    const asked = server.requests
      .filter((request) => request.path === "/authorize")
      .map((request) => (request.body as URLSearchParams).get("client_id"));
    expect(asked).toEqual(["client-forgotten", "client-1"]);
  });

  it("doesn't register another client when the server knows the stored one", async () => {
    const server = authServer();
    server.clientIds.add("client-known");
    authorizedBy(server);
    await browser.storage.local.set({ clientId: "client-known" });

    expect(await signIn()).toBe(true);

    expect(server.count("/register")).toBe(0);
    expect((await stored()).clientId).toBe("client-known");
  });

  it("registers once, even if the server doesn't know the client it just registered", async () => {
    const server = authServer();
    windowEnds((state) =>
      callback({ error: "invalid_client", error_description: "unknown_client", state }),
    );

    expect(await signIn()).toBe(false);

    expect(server.count("/register")).toBe(1);
    expect(await takeSignInProblem()).toBe("failed");
  });

  it("forgets the client when the token endpoint says it doesn't know it", async () => {
    const server = authServer();
    authorizedBy(server);
    server.tokenFailure = { status: 400, error: "invalid_client" };

    expect(await signIn()).toBe(false);

    expect((await stored()).clientId).toBeUndefined();
    expect(await takeSignInProblem()).toBe("failed");
  });

  it("keeps the client when the code itself is refused", async () => {
    const server = authServer();
    authorizedBy(server);
    server.tokenFailure = { status: 400, error: "invalid_grant" };

    expect(await signIn()).toBe(false);

    expect((await stored()).clientId).toBe("client-1");
    expect(await takeSignInProblem()).toBe("failed");
  });
});

describe("the access token", () => {
  it("is null when signed out", async () => {
    authServer();
    expect(await accessToken()).toBeNull();
  });

  it("is the stored one while it has more than a minute left", async () => {
    const server = authServer();
    await signedInWith(120);

    expect(await accessToken()).toBe("access-old");
    expect(server.count("/token")).toBe(0);
  });

  it("is refreshed once it has less than a minute left", async () => {
    authServer();
    await signedInWith(30);

    expect(await accessToken()).toBe("access-1");
    expect((await stored()).tokens).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  it("is refreshed when the API refused the stored one, however fresh it looks", async () => {
    authServer();
    await signedInWith(3000);

    expect(await accessToken({ stale: true })).toBe("access-1");
  });

  it("is refreshed once when two callers need one at the same time", async () => {
    const server = authServer();
    await signedInWith(0);

    const tokens = await Promise.all([accessToken(), accessToken({ stale: true })]);

    // Refresh tokens rotate: a second request would spend the old one again and be refused.
    expect(tokens).toEqual(["access-1", "access-1"]);
    expect(server.count("/token")).toBe(1);
    expect(await isSignedIn()).toBe(true);
  });

  it.each([400, 401])("signs out when the refresh is refused with %i", async (status) => {
    const server = authServer();
    await signedInWith(0);
    server.tokenFailure = { status, error: "invalid_grant" };

    expect(await accessToken()).toBeNull();

    expect(await isSignedIn()).toBe(false);
    // The client is this install's own: only the server saying it's unknown retires it.
    expect((await stored()).clientId).toBe("client-1");
  });

  it("also forgets the client when the refresh says it is unknown", async () => {
    const server = authServer();
    await signedInWith(0);
    server.tokenFailure = { status: 400, error: "invalid_client" };

    expect(await accessToken()).toBeNull();

    expect(await stored()).toEqual({});
  });

  it.each([
    ["answers 503", { status: 503 }],
    ["can't be reached", "network" as const],
  ])("throws and stays signed in when the server %s", async (_, failure) => {
    const server = authServer();
    await signedInWith(0);
    server.tokenFailure = failure;

    await expect(accessToken()).rejects.toThrow();

    expect(await isSignedIn()).toBe(true);
    expect((await stored()).tokens?.refreshToken).toBe("refresh-0");

    // And the next call tries again, rather than keeping the failure.
    server.tokenFailure = undefined;
    expect(await accessToken()).toBe("access-1");
  });
});

describe("signing out", () => {
  it("drops the tokens and revokes the refresh token", async () => {
    const server = authServer();
    await signedInWith(3000, "refresh-0");

    await signOut();

    expect(await isSignedIn()).toBe(false);
    const revoked = server.requests.find((request) => request.path === "/revoke")?.body;
    expect(revoked).toBeInstanceOf(URLSearchParams);
    const form = revoked as URLSearchParams;
    expect(form.get("token")).toBe("refresh-0");
    expect(form.get("client_id")).toBe("client-1");
  });

  it("still signs out when the revocation can't be sent", async () => {
    const server = authServer();
    server.revokeFails = true;
    await signedInWith(3000);

    await expect(signOut()).resolves.toBeUndefined();

    expect(await isSignedIn()).toBe(false);
  });

  it("has nothing to revoke when signed out already", async () => {
    const server = authServer();

    await signOut();

    expect(server.count("/revoke")).toBe(0);
  });
});
