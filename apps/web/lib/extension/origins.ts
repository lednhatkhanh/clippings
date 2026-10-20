import {
  CLIPPINGS_EXTENSION_ID,
  EXTENSION_API_PATH,
  type ExtensionSignInError,
} from "@clippings/shared";

/** A Chrome extension id: 32 letters from a to p. */
const EXTENSION_ID = /^[a-p]{32}$/;

/**
 * The extension ids the app trusts: the one its manifest key pins, plus any in `EXTENSION_IDS`
 * (comma- or whitespace-separated), such as the id a store listing assigns.
 */
export function parseExtensionIds(raw: string | undefined): string[] {
  const extra = (raw ?? "").split(/[\s,]+/).filter((id) => EXTENSION_ID.test(id));
  return [...new Set([CLIPPINGS_EXTENSION_ID, ...extra])];
}

/** The `Origin` the extension's service worker sends. */
export const extensionOrigin = (id: string) => `chrome-extension://${id}`;

/** Where `chrome.identity.launchWebAuthFlow` hands the authorization back to the extension. */
export const extensionRedirectUri = (id: string) => `https://${id}.chromiumapp.org/`;

/** Whether the authorization goes back to one of the trusted extensions. */
export function isExtensionRedirectUri(uri: string, extensionIds: readonly string[]): boolean {
  return extensionIds.some((id) => uri === extensionRedirectUri(id));
}

/**
 * The extension API's resource identifier (RFC 8707): its public URL. The extension's access
 * tokens carry it as their audience, so they are good only there, and `/mcp` tokens aren't.
 */
export function extensionResourceUrl(origin = process.env.BETTER_AUTH_URL): string {
  if (!origin) throw new Error("BETTER_AUTH_URL is not set");
  return new URL(EXTENSION_API_PATH, origin).toString();
}

/**
 * Where an authorization the extension started ends when it can't go ahead: back at the
 * extension with an OAuth error, so the popup can say why, instead of on a page in the sign-in
 * window. Undefined when the authorization isn't the extension's.
 */
export function extensionErrorRedirect(
  oauthQuery: URLSearchParams,
  extensionIds: readonly string[],
  error: "access_denied",
  description: ExtensionSignInError,
): string | undefined {
  const redirectUri = oauthQuery.get("redirect_uri") ?? "";
  if (!isExtensionRedirectUri(redirectUri, extensionIds)) return undefined;
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  const state = oauthQuery.get("state");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
