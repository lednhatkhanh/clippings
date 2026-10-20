/** The query parameter that carries where sign-in should return to. */
export const RETURN_TO_PARAM = "returnTo";

// Any origin works: a path is safe only when resolving it against this one stays here.
const BASE = "https://clippings.invalid";

/**
 * A path on this site to go back to after sign-in, or null for anything else: an absolute URL,
 * a protocol-relative `//host`, or a path the URL parser would turn into one.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  // `/.//host` stays on this origin but resolves to the path `//host`, which a browser would
  // follow to another site.
  if (url.origin !== BASE || url.pathname.startsWith("//")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `path`, carrying the page to return to after sign-in when there is one. */
export function withReturnTo(path: string, returnTo: string | null): string {
  return returnTo ? `${path}?${new URLSearchParams({ [RETURN_TO_PARAM]: returnTo })}` : path;
}
