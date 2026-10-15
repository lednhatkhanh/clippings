const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `mailto:`, `javascript:`, `data:` and the like. A digit after the colon is a port (`host:3000`). */
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d|\/\/)/i;

/** Query parameters that say how a link was reached, not which page it is. */
const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
]);

const isTracking = (name: string) =>
  name.startsWith("utm_") || TRACKING_PARAMETERS.has(name.toLowerCase());

export interface WebUrl {
  /** The address as the user gave it, made absolute: scheme added, host lowercased. */
  url: string;
  /**
   * What two saves of "the same page" have in common. The host's case, default ports, the
   * fragment, a trailing slash, tracking parameters and the order of the other parameters don't
   * count.
   */
  normalized: string;
}

/**
 * Reads an http(s) address, or returns null for anything else: other schemes, addresses with
 * credentials, text that isn't a URL. A missing scheme is read as https.
 */
export function parseWebUrl(input: string): WebUrl | null {
  const trimmed = input.trim();
  if (!trimmed || OTHER_SCHEME.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(EXPLICIT_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const parameters = [...url.searchParams]
    .filter(([name]) => !isTracking(name))
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(parameters).toString();
  const path = url.pathname.replace(/\/+$/, "");

  return {
    url: url.href,
    normalized: `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}`,
  };
}
