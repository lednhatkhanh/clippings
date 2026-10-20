/** Where the MCP endpoint is served. */
export const MCP_PATH = "/mcp";

/**
 * The MCP endpoint's resource identifier (RFC 8707 / RFC 9728): its public URL. Access tokens
 * carry it as their audience, so a token issued for `/mcp` is good only there.
 */
export function mcpResourceUrl(origin = process.env.BETTER_AUTH_URL): string {
  if (!origin) throw new Error("BETTER_AUTH_URL is not set");
  return new URL(MCP_PATH, origin).toString();
}
