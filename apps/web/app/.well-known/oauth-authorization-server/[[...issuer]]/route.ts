import { getAuth } from "@/lib/auth/auth.ts";

/**
 * RFC 8414 authorization server metadata. The issuer is `/api/auth`, so clients look for it at
 * `/.well-known/oauth-authorization-server/api/auth`, outside the auth route; the auth handler
 * answers it.
 */
export function GET(request: Request) {
  return getAuth().handler(request);
}
