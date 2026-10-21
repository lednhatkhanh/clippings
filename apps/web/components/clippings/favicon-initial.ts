/**
 * The letter a site's tile shows when it has no favicon: the first letter of its host, without
 * `www.`, in capitals. "?" when the address has no host to take it from.
 */
export function faviconInitial(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");
    const codePoint = host.codePointAt(0);
    return codePoint === undefined ? "?" : String.fromCodePoint(codePoint).toLocaleUpperCase("en");
  } catch {
    return "?";
  }
}
