/**
 * The OAuth scope that lets a connected client change and delete clippings. `/mcp` offers the
 * write tools only to an access token that carries it.
 */
export const WRITE_SCOPE = "clippings:write";

/**
 * The scopes a client gets when it asks for none: Better Auth's defaults, without
 * `clippings:write`. A client has to ask for write access by name.
 */
export const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

/**
 * The scopes an authorization request asks for, without `clippings:write`: what "Allow read-only"
 * on the consent page grants. Empty when the request asks for nothing else.
 */
export function readOnlyScopes(requested: string | null | undefined): string[] {
  return (requested ?? "").split(" ").filter((scope) => scope !== "" && scope !== WRITE_SCOPE);
}
