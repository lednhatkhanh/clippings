import { addSeconds, constructNow } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { formatIsoUtc } from "@clippings/shared";

import { listTags, lookupClipping, saveClipping, saveNote, saveTags } from "./api.ts";
import { isSignedIn } from "./auth.ts";

const API = "http://localhost:3100/api/extension";
const TOKEN_URL = "http://localhost:3100/api/auth/oauth2/token";

const clipping = (link = "http://localhost:3100/c/c1") => ({
  id: "c1",
  url: "https://example.com/essay",
  title: "Essay",
  note: "",
  tags: [],
  createdAt: "2026-10-20T10:00:00.000Z",
  link,
});

type Answer = Response | Error;

/**
 * A stand-in for the API and the token endpoint. `api` answers each call to the extension API
 * (given the bearer token it carried); a refresh issues `access-new` unless `refresh` says
 * otherwise.
 */
function serve(
  api: (token: string, path: string) => Answer,
  refresh: () => Answer = () =>
    Response.json({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 }),
) {
  const seen = { api: [] as string[], tokenRequests: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const answer =
        url === TOKEN_URL
          ? ((seen.tokenRequests += 1), refresh())
          : (seen.api.push(url.replace(API, "")),
            api(
              new Headers(init?.headers).get("authorization")?.slice("Bearer ".length) ?? "",
              url,
            ));
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  );
  return seen;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function signedIn() {
  return browser.storage.local.set({
    clientId: "client-1",
    tokens: {
      accessToken: "access-old",
      refreshToken: "refresh-old",
      expiresAt: formatIsoUtc(addSeconds(constructNow(undefined), 3000)),
    },
  });
}

const online = (onLine: boolean) => vi.stubGlobal("navigator", { onLine });

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  online(true);
  await signedIn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saving a page", () => {
  it("answers what the API saved", async () => {
    serve(() => json({ status: "created", clipping: clipping() }, 201));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: true,
      saved: { status: "created", clipping: clipping() },
    });
  });

  it("refreshes the token the API refused and tries again, once", async () => {
    const seen = serve((token) =>
      token === "access-new"
        ? json({ status: "created", clipping: clipping() })
        : json({ error: "invalid_token" }, 401),
    );

    const result = await saveClipping("https://example.com/essay");

    expect(result.ok).toBe(true);
    expect(seen.tokenRequests).toBe(1);
    expect(seen.api).toHaveLength(2);
  });

  it("answers a second refusal as it is, without refreshing again or signing out", async () => {
    const seen = serve(() => json({ error: "invalid_token" }, 401));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "failed",
    });

    expect(seen.tokenRequests).toBe(1);
    expect(seen.api).toHaveLength(2);
    expect(await isSignedIn()).toBe(true);
  });

  it("signs out when the refresh is refused", async () => {
    const seen = serve(
      () => json({ error: "invalid_token" }, 401),
      () => json({ error: "invalid_grant" }, 400),
    );

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "signed_out",
    });

    expect(seen.api).toHaveLength(1);
    expect(await isSignedIn()).toBe(false);
  });

  it("is signed out, without calling the API, when there are no tokens", async () => {
    await browser.storage.local.remove("tokens");
    const seen = serve(() => json({}));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "signed_out",
    });
    expect(seen.api).toEqual([]);
  });

  it("forgets the tokens when the account is no longer on the allowlist", async () => {
    serve(() => json({ error: "not_allowlisted" }, 403));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "not_allowlisted",
    });

    expect(await isSignedIn()).toBe(false);
  });

  it.each([
    ["a link on another origin", "https://evil.example/c/c1"],
    ["a link on the same host and another port", "http://localhost:4000/c/c1"],
    [
      "a link that is this origin in a userinfo disguise",
      "http://localhost:3100@evil.example/c/c1",
    ],
  ])("refuses a result with %s", async (_, link) => {
    serve(() => json({ status: "created", clipping: clipping(link) }, 201));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("refuses a result that isn't a saved clipping", async () => {
    serve(() => json({ status: "created" }, 201));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it.each([
    ["invalid_url", 400, "invalid_url"],
    ["invalid_request", 400, "failed"],
    ["something_new", 400, "failed"],
    ["invalid_token", 401, "failed"],
  ])("maps the API's %s (%i) to %s", async (error, status, reason) => {
    // A 401 would be refreshed first: the refresh issues a token the API refuses again.
    serve(() => json({ error }, status));

    expect(await saveClipping("https://example.com/essay")).toEqual({ ok: false, reason });
  });

  it("is failed when the API's error isn't JSON", async () => {
    serve(() => new Response("<html>Bad gateway</html>", { status: 502 }));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("is offline when the browser is offline and the request doesn't get through", async () => {
    online(false);
    serve(() => new TypeError("Failed to fetch"));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "offline",
    });
  });

  it("is failed when the request doesn't get through but the browser is online", async () => {
    serve(() => new TypeError("Failed to fetch"));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("is failed, not offline, when the server answers with an error", async () => {
    online(false);
    serve(() => json({ error: "boom" }, 503));

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("is failed when the refresh can't reach the server, and stays signed in", async () => {
    serve(
      () => json({ error: "invalid_token" }, 401),
      () => new TypeError("Failed to fetch"),
    );

    expect(await saveClipping("https://example.com/essay")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(await isSignedIn()).toBe(true);
  });
});

describe("changing a clipping", () => {
  it("saves a note", async () => {
    serve(() => json(clipping()));
    expect(await saveNote("c1", "a note")).toBe("saved");
  });

  it("saves tags and answers them as stored", async () => {
    const tags = [{ id: "t1", name: "reading", color: "blue" }];
    serve(() => json({ ...clipping(), tags }));

    expect(await saveTags("c1", ["reading"])).toEqual({ type: "saved", tags });
  });

  it("answers gone when the clipping was deleted in the meantime", async () => {
    serve(() => json({ error: "not_found" }, 404));

    expect(await saveNote("c1", "a note")).toBe("gone");
    expect(await saveTags("c1", [])).toEqual({ type: "gone" });
  });

  it.each([
    ["an error", () => json({ error: "boom" }, 500)],
    ["a network failure", () => new TypeError("Failed to fetch")],
    ["a reply that isn't a clipping", () => json({ nope: true })],
  ])("answers failed on %s", async (_, answer) => {
    serve(answer);

    expect(await saveNote("c1", "a note")).toBe("failed");
    expect(await saveTags("c1", [])).toEqual({ type: "failed" });
  });

  it("answers failed when signed out", async () => {
    await browser.storage.local.remove("tokens");
    serve(() => json(clipping()));

    expect(await saveNote("c1", "a note")).toBe("failed");
  });
});

describe("reading", () => {
  it("lists the tags, or null when they can't be read", async () => {
    const tags = [{ id: "t1", name: "reading", color: "blue" }];
    serve(() => json(tags));
    expect(await listTags()).toEqual(tags);

    serve(() => json({ error: "boom" }, 500));
    expect(await listTags()).toBeNull();

    serve(() => new TypeError("Failed to fetch"));
    expect(await listTags()).toBeNull();
  });

  it("looks a page up, and doesn't know when it can't", async () => {
    serve(() => json({ saved: true }));
    expect(await lookupClipping("https://example.com/a")).toBe("saved");

    serve(() => json({ saved: false }));
    expect(await lookupClipping("https://example.com/a")).toBe("not_saved");

    serve(() => json({ error: "boom" }, 500));
    expect(await lookupClipping("https://example.com/a")).toBe("unknown");

    serve(() => new TypeError("Failed to fetch"));
    expect(await lookupClipping("https://example.com/a")).toBe("unknown");
  });
});
