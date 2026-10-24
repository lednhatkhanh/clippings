/**
 * Test helpers for driving the app's real Better Auth through its OAuth flow: sign in, register a
 * client, authorize, allow on the consent page and trade the code. Used by the route tests only;
 * nothing in the app imports this file, so it isn't part of the app bundle.
 */
import { createHash, randomBytes } from "node:crypto";

import { expect, vi } from "vitest";

import { createAuth } from "@/lib/auth/auth.ts";
import { createDatabase, type createPool } from "@clippings/db";
import { createTestSession, sessionCookieName } from "@clippings/db/testing";

export const TEST_SECRET = "test-secret-test-secret-test-secret-0123";

/** What a browser follows a redirect with: a top-level navigation. */
export const browserHeaders = { accept: "text/html", "sec-fetch-mode": "navigate" };

type Pool = ReturnType<typeof createPool>;
export type AuthCall = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * The app's auth on the test database, and a function that calls its handler. It also stands in
 * for `fetch` so the routes that verify access tokens fetch the signing keys from this auth;
 * undo it with `vi.unstubAllGlobals()`.
 */
export function serveAuth({
  pool,
  origin,
  allowedEmails,
  extensionIds = [],
  rateLimit,
}: {
  pool: Pool;
  origin: string;
  allowedEmails: string;
  extensionIds?: readonly string[];
  /** Turns rate limiting on, which tests otherwise skip (it is on in production only). */
  rateLimit?: { enabled: boolean };
}) {
  const auth = createAuth({
    database: createDatabase(pool),
    baseURL: origin,
    secret: TEST_SECRET,
    allowedEmails,
    google: { clientId: "test", clientSecret: "test" },
    extensionIds,
    ...(rateLimit ? { rateLimit } : {}),
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    auth.handler(new Request(input, init)),
  );
  const call: AuthCall = (path, init) => auth.handler(new Request(`${origin}${path}`, init));
  return { auth, call };
}

/** A signed-in browser for this user: their session cookie, as Better Auth signs it. */
export async function signIn(pool: Pool, id: string, email: string): Promise<string> {
  const { cookieValue } = await createTestSession({
    db: pool,
    secret: TEST_SECRET,
    user: { id, name: id, email },
    sessionId: `s-${id}`,
  });
  return `${sessionCookieName({ secure: false })}=${cookieValue}`;
}

/** Where a response sends the browser: its Location, or the provider's JSON redirect. */
export async function target(response: Response): Promise<string> {
  const location = response.headers.get("location");
  if (location) return location;
  const body = (await response.json()) as { url?: string };
  return body.url ?? "";
}

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** `POST /oauth2/register`, as a public client with these fields. */
export function registerClient(
  call: AuthCall,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return call("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      client_name: "Claude Code",
      token_endpoint_auth_method: "none",
      ...body,
    }),
  });
}

/** The id a successful registration answered with. */
export async function registeredClientId(response: Response): Promise<string> {
  return ((await response.json()) as { client_id: string }).client_id;
}

export interface AuthorizeRequest {
  clientId: string;
  challenge: string;
  redirectUri: string;
  /** The resources the token is for; one `resource` parameter each. */
  resources?: readonly string[];
  scope?: string;
  prompt?: string;
  state?: string;
}

export function authorizePath({
  clientId,
  challenge,
  redirectUri,
  resources = [],
  scope,
  prompt,
  state = "state-1",
}: AuthorizeRequest) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (scope) params.set("scope", scope);
  if (prompt) params.set("prompt", prompt);
  for (const resource of resources) params.append("resource", resource);
  return `/api/auth/oauth2/authorize?${params}`;
}

/**
 * `POST /oauth2/consent`, as the consent page sends it with the signed `oauth_query`. `scope`
 * narrows the grant, as "Allow read-only" does.
 */
export function consent(
  call: AuthCall,
  {
    cookie,
    origin,
    query,
    accept = true,
    scope,
  }: { cookie?: string; origin: string; query: string; accept?: boolean; scope?: string },
) {
  return call("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ accept, oauth_query: query, ...(scope === undefined ? {} : { scope }) }),
  });
}

/** The consent page's signed query, from an authorization the signed-in user started. */
export async function consentQuery(
  call: AuthCall,
  cookie: string,
  request: Omit<AuthorizeRequest, "challenge">,
): Promise<string> {
  const page = await target(
    await call(authorizePath({ ...request, challenge: pkce().challenge }), {
      headers: { cookie, ...browserHeaders },
    }),
  );
  expect(page).toMatch(/^\/connect\?/);
  return page.slice("/connect?".length);
}

export interface Authorization {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  resources: readonly string[];
}

/**
 * Authorizes as the signed-in user and allows on the consent page, for `consentScope` when
 * given; returns the code.
 */
export async function authorize(
  call: AuthCall,
  cookie: string,
  origin: string,
  request: Omit<AuthorizeRequest, "challenge">,
  consentScope?: string,
): Promise<Authorization> {
  const { verifier, challenge } = pkce();
  const consentPage = await target(
    await call(authorizePath({ ...request, challenge }), {
      headers: { cookie, ...browserHeaders },
    }),
  );
  expect(consentPage).toMatch(/^\/connect\?/);

  const answered = await consent(call, {
    cookie,
    origin,
    query: consentPage.slice("/connect?".length),
    scope: consentScope,
  });
  const callback = new URL(await target(answered));
  expect(callback.origin).toBe(new URL(request.redirectUri).origin);
  return {
    code: callback.searchParams.get("code") ?? "",
    verifier,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    resources: request.resources ?? [],
  };
}

/** Trades the code for tokens; `headers` adds the caller's `Origin`, as the extension sends. */
export function exchange(
  call: AuthCall,
  { code, verifier, clientId, redirectUri, resources }: Authorization,
  headers: Record<string, string> = {},
) {
  return call("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams([
      ["grant_type", "authorization_code"],
      ["code", code],
      ["redirect_uri", redirectUri],
      ["client_id", clientId],
      ["code_verifier", verifier],
      ...resources.map((resource): [string, string] => ["resource", resource]),
    ]),
  });
}

/** Authorizes, allows (for `consentScope` when given) and trades the code: the tokens a connected client holds. */
export async function connect(
  call: AuthCall,
  cookie: string,
  origin: string,
  request: Omit<AuthorizeRequest, "challenge">,
  headers: Record<string, string> = {},
  consentScope?: string,
) {
  const token = await exchange(
    call,
    await authorize(call, cookie, origin, request, consentScope),
    headers,
  );
  expect(token.status).toBe(200);
  const issued = (await token.json()) as { access_token: string; refresh_token?: string };
  return { ...issued, clientId: request.clientId };
}

/** The `refresh_token` grant. */
export function refreshTokens(
  call: AuthCall,
  {
    refreshToken,
    clientId,
    resources = [],
  }: { refreshToken: string; clientId: string; resources?: readonly string[] },
) {
  return call("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams([
      ["grant_type", "refresh_token"],
      ["refresh_token", refreshToken],
      ["client_id", clientId],
      ...resources.map((resource): [string, string] => ["resource", resource]),
    ]),
  });
}
