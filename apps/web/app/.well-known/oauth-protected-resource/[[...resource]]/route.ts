import { getAuth } from "@/lib/auth/auth.ts";

/**
 * RFC 9728 protected resource metadata for `/mcp`, at `/.well-known/oauth-protected-resource/mcp`
 * (and the bare root): which authorization server issues its tokens. The MCP plugin answers it
 * through the auth handler.
 */
export function GET(request: Request) {
  return getAuth().handler(request);
}
