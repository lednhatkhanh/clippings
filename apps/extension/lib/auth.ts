import { addSeconds, constructNow, isBefore, parseISO, subSeconds } from "date-fns";
import { browser } from "wxt/browser";

import { EXTENSION_API_PATH, formatIsoUtc, UNKNOWN_CLIENT } from "@clippings/shared";

import { clearLookups } from "./lookup-cache-storage.ts";
import type { SignInProblem } from "./messages.ts";
import { request } from "./request.ts";

/** The Clippings web app: its authorization server and the extension API. */
export const CLIPPINGS_ORIGIN = import.meta.env.CLIPPINGS_ORIGIN;
const AUTH_URL = `${CLIPPINGS_ORIGIN}/api/auth`;

/** The resource the extension's tokens are issued for: the extension API, and nothing else. */
export const API_RESOURCE = new URL(EXTENSION_API_PATH, CLIPPINGS_ORIGIN).toString();

/** A token response never refreshes later than this before it expires. */
const EXPIRY_MARGIN_SECONDS = 60;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601. */
  expiresAt: string;
}

interface Stored {
  /** This install's OAuth client, registered at its first sign-in. */
  clientId?: string;
  tokens?: Tokens;
}

/** Kept on this device only: the sign-in is this browser's, not the user's other browsers'. */
async function readStored(): Promise<Stored> {
  return (await browser.storage.local.get(["clientId", "tokens"])) as Stored;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const randomString = (length: number) => base64url(crypto.getRandomValues(new Uint8Array(length)));

async function pkce() {
  const verifier = randomString(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/**
 * Registers this install as a public OAuth client (PKCE, no secret) whose only redirect is the
 * extension's own `chromiumapp.org` address, and whose tokens may be for the extension API.
 */
async function registerClient(): Promise<string> {
  const response = await request(`${AUTH_URL}/oauth2/register`, {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Clippings for Chrome",
      redirect_uris: [browser.identity.getRedirectURL()],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      resources: [API_RESOURCE],
    }),
  });
  if (!response.ok) throw new Error(`Registration answered ${response.status}`);
  const { client_id: clientId } = (await response.json()) as { client_id?: unknown };
  if (typeof clientId !== "string") throw new Error("Registration returned no client id");
  await browser.storage.local.set({ clientId });
  return clientId;
}

/** Calls the token endpoint and keeps what it issues. Null when the grant was refused. */
async function requestTokens(params: Record<string, string>): Promise<Tokens | null> {
  const response = await request(`${AUTH_URL}/oauth2/token`, {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, resource: API_RESOURCE }),
  });
  // 400 and 401 are the grant or the client being refused: an expired or revoked refresh token,
  // or a client the server no longer knows. Anything else is the server or the network.
  if (response.status === 400 || response.status === 401) {
    // Only this says the client is gone; a refused grant leaves the client as it is.
    const { error } = (await response.json().catch(() => ({}))) as { error?: unknown };
    if (error === "invalid_client") await browser.storage.local.remove("clientId");
    return null;
  }
  if (!response.ok) throw new Error(`The token endpoint answered ${response.status}`);
  const body = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
    throw new Error("The token endpoint returned no tokens");
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  const tokens: Tokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: formatIsoUtc(addSeconds(constructNow(undefined), expiresIn)),
  };
  await browser.storage.local.set({ tokens });
  return tokens;
}

async function setSignInProblem(problem: SignInProblem | null) {
  await browser.storage.session.set({ signInProblem: problem });
}

/** Why the last sign-in didn't finish, once: reading it clears it. */
export async function takeSignInProblem(): Promise<SignInProblem | null> {
  const { signInProblem } = (await browser.storage.session.get("signInProblem")) as {
    signInProblem?: SignInProblem | null;
  };
  if (signInProblem) await setSignInProblem(null);
  return signInProblem ?? null;
}

export async function isSignedIn(): Promise<boolean> {
  return Boolean((await readStored()).tokens);
}

/**
 * Drops this device's tokens: the user signs in again on the next save. The answers kept about
 * which pages are saved go too, as they were the signed-in user's.
 */
export async function forgetTokens() {
  await browser.storage.local.remove("tokens");
  await clearLookups();
}

/** What the authorization server's refusal, sent back to the extension, means for the popup. */
function problemFrom(callback: URL): SignInProblem {
  const description = callback.searchParams.get("error_description");
  if (description === "not_allowlisted" || description === "denied") return description;
  return "failed";
}

/** How an authorization in the sign-in window ended. */
type Authorization =
  | { kind: "closed" }
  | { kind: "answered"; callback: URL; verifier: string; redirectUri: string };

/** Opens the sign-in window for this client, and waits for it to send the browser back. */
async function authorize(clientId: string): Promise<Authorization> {
  const { verifier, challenge } = await pkce();
  const state = randomString(16);
  const redirectUri = browser.identity.getRedirectURL();
  const url = new URL(`${AUTH_URL}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: API_RESOURCE,
  }).toString();

  let responseUrl: string | undefined;
  try {
    responseUrl = await browser.identity.launchWebAuthFlow({
      url: url.toString(),
      interactive: true,
    });
  } catch {
    // The window was closed, or its page didn't load, before the authorization came back.
    return { kind: "closed" };
  }
  const callback = new URL(responseUrl ?? "");
  if (callback.searchParams.get("state") !== state) throw new Error("The state didn't match");
  return { kind: "answered", callback, verifier, redirectUri };
}

/** Whether the authorization server said it doesn't know this install's OAuth client. */
const isUnknownClient = (callback: URL) =>
  callback.searchParams.get("error") === "invalid_client" &&
  callback.searchParams.get("error_description") === UNKNOWN_CLIENT;

/**
 * Signs in through the Clippings authorization server, in a browser window: Google sign-in with
 * the allowlist, then the consent page. The authorization code comes back to the extension's
 * `chromiumapp.org` address, and is traded for tokens bound to the extension API, with PKCE.
 * The popup closes when the window opens, so a problem is kept for the next popup to say.
 */
export async function signIn(): Promise<boolean> {
  await setSignInProblem(null);
  try {
    const storedClientId = (await readStored()).clientId;
    let clientId = storedClientId ?? (await registerClient());
    let authorization = await authorize(clientId);
    if (
      storedClientId &&
      authorization.kind === "answered" &&
      isUnknownClient(authorization.callback)
    ) {
      // The server has lost the client this install registered (a restored database, a reset
      // branch, a build pointed at another origin) and sends the window back with a say-so
      // rather than an error page: ask again with a new one. Only a stored client is replaced,
      // so a server that keeps saying so about a fresh one ends in "failed".
      await browser.storage.local.remove("clientId");
      clientId = await registerClient();
      authorization = await authorize(clientId);
    }
    if (authorization.kind === "closed") {
      // The client stays: registration is open to anyone, so a new client for every cancelled
      // sign-in would pile up on the server. The server says a client is unknown when the window
      // is sent back (above) and at the token endpoint (`requestTokens`), never by closing it.
      await setSignInProblem("cancelled");
      return false;
    }

    const { callback, verifier, redirectUri } = authorization;
    if (callback.searchParams.has("error")) {
      await setSignInProblem(problemFrom(callback));
      return false;
    }
    const tokens = await requestTokens({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") ?? "",
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (!tokens) throw new Error("The authorization code was refused");
    // Another account may have signed in: what was kept about the last one's saves is not theirs.
    await clearLookups();
    return true;
  } catch (error) {
    console.error("Couldn't sign in", error);
    await setSignInProblem("failed");
    return false;
  }
}

/** Signs out on this device, and revokes the refresh token so it can't be used again. */
export async function signOut() {
  const { clientId, tokens } = await readStored();
  await forgetTokens();
  if (!clientId || !tokens) return;
  await request(`${AUTH_URL}/oauth2/revoke`, {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: tokens.refreshToken,
      token_type_hint: "refresh_token",
      client_id: clientId,
    }),
  }).catch((error: unknown) => console.error("Couldn't revoke the refresh token", error));
}

/**
 * A refresh in flight, shared by the calls that need one. Refresh tokens rotate, so two
 * refreshes at once would spend the same token twice. It only lives as long as the service
 * worker does, which is all it needs: the tokens themselves are in storage.
 */
let refreshing: Promise<string | null> | undefined;

async function refresh(): Promise<string | null> {
  const { clientId, tokens } = await readStored();
  if (!clientId || !tokens) return null;
  const refreshed = await requestTokens({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  if (!refreshed) await forgetTokens();
  return refreshed?.accessToken ?? null;
}

/**
 * A current access token, refreshed when it is about to expire or when `stale` says the API
 * refused it. Null when signed out. Throws when the server can't be reached.
 */
export async function accessToken({ stale = false } = {}): Promise<string | null> {
  const { tokens } = await readStored();
  if (!tokens) return null;
  const freshUntil = subSeconds(parseISO(tokens.expiresAt), EXPIRY_MARGIN_SECONDS);
  if (!stale && isBefore(constructNow(undefined), freshUntil)) return tokens.accessToken;
  refreshing ??= refresh().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}
