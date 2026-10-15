const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

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

/**
 * The address two saves of "the same page" have in common, or null when `input` is not an
 * http(s) URL. A missing scheme is read as https. The host's case, default ports, the fragment,
 * a trailing slash, tracking parameters and the order of the remaining parameters don't count.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(EXPLICIT_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const parameters = [...url.searchParams]
    .filter(([name]) => !isTracking(name))
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(parameters).toString();

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ""}`;
}
