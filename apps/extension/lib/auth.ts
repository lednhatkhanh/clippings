import { addSeconds, constructNow, isBefore, parseISO, subSeconds } from "date-fns";
import { browser } from "wxt/browser";

import { EXTENSION_API_PATH, formatIsoUtc } from "@clippings/shared";

import type { SignInProblem } from "./messages.ts";

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
  const response = await fetch(`${AUTH_URL}/oauth2/register`, {
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
  const response = await fetch(`${AUTH_URL}/oauth2/token`, {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, resource: API_RESOURCE }),
  });
  // 400 and 401 are the grant or the client being refused: an expired or revoked refresh token,
  // or a client the server no longer knows. Anything else is the server or the network.
  if (response.status === 400 || response.status === 401) return null;
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

/** Drops this device's tokens: the user signs in again on the next save. */
export async function forgetTokens() {
  await browser.storage.local.remove("tokens");
}

/** What the authorization server's refusal, sent back to the extension, means for the popup. */
function problemFrom(callback: URL): SignInProblem {
  const description = callback.searchParams.get("error_description");
  if (description === "not_allowlisted" || description === "denied") return description;
  return "failed";
}

/**
 * Signs in through the Clippings authorization server, in a browser window: Google sign-in with
 * the allowlist, then the consent page. The authorization code comes back to the extension's
 * `chromiumapp.org` address, and is traded for tokens bound to the extension API, with PKCE.
 * The popup closes when the window opens, so a problem is kept for the next popup to say.
 */
export async function signIn(): Promise<boolean> {
  await setSignInProblem(null);
  try {
    const clientId = (await readStored()).clientId ?? (await registerClient());
    const { verifier, challenge } = await pkce();
    const state = randomString(16);
    const redirectUri = browser.identity.getRedirectURL();
    const authorize = new URL(`${AUTH_URL}/oauth2/authorize`);
    authorize.search = new URLSearchParams({
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
        url: authorize.toString(),
        interactive: true,
      });
    } catch {
      // The window was closed before the authorization came back. That is also how a client the
      // server no longer knows ends (on the server's own page), so the next sign-in registers
      // this install afresh.
      await browser.storage.local.remove("clientId");
      await setSignInProblem("cancelled");
      return false;
    }

    const callback = new URL(responseUrl ?? "");
    if (callback.searchParams.get("state") !== state) throw new Error("The state didn't match");
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
  await fetch(`${AUTH_URL}/oauth2/revoke`, {
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
