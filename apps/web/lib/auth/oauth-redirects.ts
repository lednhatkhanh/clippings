/** Where claude.ai sends a custom connector's authorization back to. */
export const CLAUDE_REDIRECT_URIS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Whether an authorization may be sent to this redirect URI: claude.ai's callback, or a loopback
 * port on this machine, where Claude Code listens. The OAuth provider has already matched it
 * against the client's registered URIs; this narrows every client, however it registered, to
 * the places Clippings expects.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (CLAUDE_REDIRECT_URIS.includes(uri)) return true;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  // `new URL` turns `127.1` into `127.0.0.1`, so compare the authority as written.
  const authority = uri.slice(url.protocol.length + 2).split(/[/?#]/, 1)[0] ?? "";
  const host = authority.replace(/:\d+$/, "");
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(host) &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
}
