/** How long an answer to "is this page saved?" is kept before the next load asks again. */
export const LOOKUP_TTL_MS = 10 * 60_000;

/** Most addresses kept; past it the oldest answers go first. */
export const MAX_CACHED_LOOKUPS = 500;

/** What the server said about each normalized address, and when (milliseconds since the epoch). */
export type LookupCache = Record<string, { saved: boolean; at: number }>;

/**
 * The answer kept for the address, or undefined when there is none or it is older than
 * `LOOKUP_TTL_MS`.
 */
export function cachedLookup(
  cache: LookupCache,
  url: string,
  now: number,
): "saved" | "not_saved" | undefined {
  const entry = Object.hasOwn(cache, url) ? cache[url] : undefined;
  if (!entry || now - entry.at >= LOOKUP_TTL_MS || entry.at > now) return undefined;
  return entry.saved ? "saved" : "not_saved";
}

/**
 * The cache with the answer for the address set, and the answers past their time left out. Over
 * `MAX_CACHED_LOOKUPS`, the oldest are dropped.
 */
export function rememberLookup(
  cache: LookupCache,
  url: string,
  saved: boolean,
  now: number,
): LookupCache {
  const fresh = Object.entries(cache).filter(
    ([address, entry]) => address !== url && now - entry.at < LOOKUP_TTL_MS && entry.at <= now,
  );
  fresh.push([url, { saved, at: now }]);
  return Object.fromEntries(fresh.sort((a, b) => a[1].at - b[1].at).slice(-MAX_CACHED_LOOKUPS));
}
