/**
 * Where the OAuth provider reads an authorization request's parameters, which its gates must
 * read from too. The provider takes the form body only for a POST that is the authorization
 * itself (`authorizeSettings` left unset, as a direct call is). The consent and continue
 * endpoints resume an authorization by calling it again with settings of their own, and then
 * the parameters are in the query, even though the request is a POST whose body is the consent
 * form. Reading the body there would check, or rewrite, the wrong request.
 */
export function authorizationRequestSource(ctx: {
  method?: string;
  body?: unknown;
  query?: unknown;
  authorizeSettings?: { isAuthorize?: boolean } | null;
}): { sent: unknown; inBody: boolean } {
  const settings = ctx.authorizeSettings ?? { isAuthorize: true };
  const inBody = ctx.method === "POST" && settings.isAuthorize === true;
  return { sent: inBody ? ctx.body : ctx.query, inBody };
}
