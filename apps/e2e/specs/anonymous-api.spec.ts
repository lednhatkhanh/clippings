import { expect, test } from "../support/fixtures.ts";
import { routeFilesFound, routeHandlers, type RouteHandler } from "../support/routes.ts";

/**
 * Route files that answer an anonymous caller with something other than 401, and why. Every
 * other route in `apps/web/app` must refuse with 401, so a new route that forgets its session
 * check fails here without anyone listing it.
 */
const NOT_401 = {
  "api/health/route.ts": "public: the smoke spec checks it",
  "sw.js/route.ts": "public: the smoke spec checks it",
  "api/auth/[...all]/route.ts": "Better Auth answers its own endpoints: checked below",
  ".well-known/oauth-authorization-server/[[...issuer]]/route.ts": "public metadata: checked below",
  ".well-known/oauth-protected-resource/[[...resource]]/route.ts": "public metadata: checked below",
  "sign-in/complete/route.ts": "redirects to sign-in: checked below",
} as const satisfies Record<string, string>;

test.use({ signedIn: false });

const refused = (handler: RouteHandler) =>
  handler.method !== "OPTIONS" && !Object.hasOwn(NOT_401, handler.file);

test.describe("every route refuses a caller with no session", () => {
  test("the reader sees every route file", () => {
    const withHandlers = new Set(routeHandlers().map((handler) => handler.file));

    // A route written in a shape the reader doesn't recognize would escape the loop below.
    expect(routeFilesFound().filter((file) => !withHandlers.has(file))).toEqual([]);
    // And the exception list names routes that exist.
    expect(routeFilesFound()).toEqual(expect.arrayContaining(Object.keys(NOT_401)));
  });

  for (const handler of routeHandlers().filter(refused)) {
    test(`${handler.method} ${handler.path} answers 401`, async ({ request }) => {
      const response = await request.fetch(handler.path, {
        method: handler.method,
        data: handler.method === "POST" || handler.method === "PATCH" ? {} : undefined,
        maxRedirects: 0,
      });

      expect(response.status()).toBe(401);
      // The bearer-token APIs (the extension, the MCP server) say how to authenticate.
      if (handler.file.startsWith("api/extension/") || handler.file.startsWith("mcp/")) {
        expect(response.headers()["www-authenticate"]).toMatch(/^Bearer/);
      }
    });
  }
});

test.describe("the routes that answer an anonymous caller otherwise", () => {
  test("the extension's CORS preflight refuses an origin that isn't an extension", async ({
    request,
  }) => {
    const preflights = routeHandlers().filter((handler) => handler.method === "OPTIONS");
    expect(preflights.length).toBeGreaterThan(0);

    for (const handler of preflights) {
      const response = await request.fetch(handler.path, {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
        },
      });
      expect(response.status(), handler.path).toBe(403);
    }
  });

  test("Better Auth reports that there is no session", async ({ request }) => {
    const response = await request.get("/api/auth/get-session");

    expect(response.status()).toBe(200);
    expect(await response.json()).toBeNull();
  });

  test("the OAuth metadata is public", async ({ request }) => {
    const server = await request.get("/.well-known/oauth-authorization-server/api/auth");
    const resource = await request.get("/.well-known/oauth-protected-resource/mcp");

    expect(server.status()).toBe(200);
    expect(await server.json()).toHaveProperty("issuer");
    expect(resource.status()).toBe(200);
    expect(await resource.json()).toHaveProperty("authorization_servers");
  });

  test("the sign-in completion route sends a visitor without a session to sign-in", async ({
    request,
  }) => {
    const response = await request.get("/sign-in/complete?returnTo=%2Ftags", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location!).pathname).toBe("/sign-in");
  });
});
