import { addHours, constructNow } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizePath,
  browserHeaders,
  consent,
  consentQuery,
  pkce,
  registeredClientId,
  registerClient,
  serveAuth,
  signIn,
  target,
} from "@/lib/auth/testing.ts";
import { extensionRedirectUri, extensionResourceUrl } from "@/lib/extension/origins.ts";
import { mcpResourceUrl } from "@/lib/mcp/resource.ts";
import { createPool } from "@clippings/db";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";
import { CLIPPINGS_EXTENSION_ID } from "@clippings/shared";

const ORIGIN = "http://localhost:3999";
const ALLOWED = "ada@example.com";
const LOOPBACK = "http://127.0.0.1:43210/callback";

describe.skipIf(!TEST_DATABASE_URL)("OAuth authorization on the real auth and database", () => {
  let fixture: ServiceFixture;
  let pool: ReturnType<typeof createPool>;
  let call: ReturnType<typeof serveAuth>["call"];
  /** Ada, signed in. */
  let cookie: string;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    pool = createPool(fixture.databaseUrl);
    ({ call } = serveAuth({
      pool,
      origin: ORIGIN,
      allowedEmails: ALLOWED,
      extensionIds: [CLIPPINGS_EXTENSION_ID],
    }));
    cookie = await signIn(pool, "ada", ALLOWED);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await pool.end();
    await fixture.close();
  });

  describe("the consent gate", () => {
    async function consentPageFor(cookie: string) {
      const clientId = await registeredClientId(
        await registerClient(call, { redirect_uris: [LOOPBACK] }),
      );
      return consentQuery(call, cookie, { clientId, redirectUri: LOOPBACK });
    }

    it("refuses an answer to the consent page from someone with no session", async () => {
      const query = await consentPageFor(cookie);

      const response = await consent(call, { origin: ORIGIN, query });
      expect(response.status).toBe(401);
      expect(await target(response)).not.toContain("code=");
    });

    it("refuses a consent answer whose signed query was changed", async () => {
      const params = new URLSearchParams(await consentPageFor(cookie));
      // The attacker points the code somewhere else, keeping the signature.
      params.set("redirect_uri", "http://127.0.0.1:6666/callback");

      const response = await consent(call, { cookie, origin: ORIGIN, query: params.toString() });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await response.json())).toMatch(/signature/i);
    });

    it("refuses a consent answer after the signed query expired", async () => {
      const query = await consentPageFor(cookie);

      // The signature covers its expiry, so only time can age it.
      vi.useFakeTimers({ toFake: ["Date"], now: addHours(constructNow(undefined), 1) });
      const response = await consent(call, { cookie, origin: ORIGIN, query });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await response.json())).toMatch(/signature/i);
    });
  });

  describe("the extension API's resource", () => {
    const EXTENSION_API = extensionResourceUrl(ORIGIN);
    const TRUSTED_EXTENSION = extensionRedirectUri(CLIPPINGS_EXTENSION_ID);

    it("lets only a client that returns to the trusted extension register for it", async () => {
      const own = await registerClient(call, {
        redirect_uris: [TRUSTED_EXTENSION],
        resources: [EXTENSION_API],
      });
      expect(own.status).toBe(201);

      // Asking for it among other resources, or returning anywhere else as well, is refused.
      for (const body of [
        { redirect_uris: [LOOPBACK], resources: [mcpResourceUrl(ORIGIN), EXTENSION_API] },
        { redirect_uris: [TRUSTED_EXTENSION, LOOPBACK], resources: [EXTENSION_API] },
      ]) {
        const response = await registerClient(call, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "invalid_target" });
      }
    });

    it("lets only an authorization that returns to the trusted extension ask for it", async () => {
      const clientId = await registeredClientId(
        await registerClient(call, { redirect_uris: [LOOPBACK] }),
      );

      // Asked for alongside /mcp, from a loopback client.
      const response = await call(
        authorizePath({
          clientId,
          challenge: pkce().challenge,
          redirectUri: LOOPBACK,
          resources: [mcpResourceUrl(ORIGIN), EXTENSION_API],
        }),
        { headers: { cookie, ...browserHeaders } },
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_target" });
    });
  });

  describe("redirect URIs", () => {
    const UNTRUSTED_EXTENSION = "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/";
    const TRUSTED_EXTENSION = extensionRedirectUri(CLIPPINGS_EXTENSION_ID);
    // However they are spelled, none of these may receive a code.
    const abusive = [
      "http://evil.example/callback",
      "http://localhost.evil.example/callback",
      "http://127.1:43210/callback",
      "http://user@127.0.0.1:43210/callback",
      "http://127.0.0.1:43210/callback#fragment",
      "https://127.0.0.1:43210/callback",
    ];

    /** Where an authorization to this redirect URI goes for a client registered with `registered`. */
    async function authorizeTo(registered: string, redirectUri: string) {
      const registration = await registerClient(call, { redirect_uris: [registered] });
      const clientId = await registeredClientId(registration);
      const response = await call(
        authorizePath({ clientId, challenge: pkce().challenge, redirectUri }),
        { headers: { cookie, ...browserHeaders } },
      );
      return target(response);
    }

    it.each(abusive)("refuses to register %s", async (uri) => {
      const response = await registerClient(call, { redirect_uris: [uri] });
      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty("client_id");
    });

    it("refuses an untrusted extension for the extension API's resource", async () => {
      const response = await registerClient(call, {
        redirect_uris: [UNTRUSTED_EXTENSION],
        resources: [extensionResourceUrl(ORIGIN)],
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_target" });
    });

    it("accepts a loopback port and the trusted extension's redirect", async () => {
      expect((await registerClient(call, { redirect_uris: [LOOPBACK] })).status).toBe(201);
      expect((await registerClient(call, { redirect_uris: [TRUSTED_EXTENSION] })).status).toBe(201);

      // A loopback client picks another port when it authorizes.
      expect(await authorizeTo(LOOPBACK, "http://127.0.0.1:51234/callback")).toMatch(
        /^\/connect\?/,
      );
      expect(await authorizeTo(TRUSTED_EXTENSION, TRUSTED_EXTENSION)).toMatch(/^\/connect\?/);
    });

    it.each(abusive)("refuses to send an authorization to %s", async (uri) => {
      expect(await authorizeTo(LOOPBACK, uri)).toMatch(/^\/sign-in\?error=/);
    });

    // Registration takes an https redirect URI; the authorization is where it is refused.
    it.each(["https://evil.example/callback", UNTRUSTED_EXTENSION])(
      "registers %s but never sends an authorization there",
      async (uri) => {
        expect(await authorizeTo(uri, uri)).toBe(
          "/sign-in?error=invalid_redirect&error_description=invalid+redirect+uri",
        );
      },
    );
  });
});
