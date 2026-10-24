import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import { extensionErrorRedirect } from "@/lib/extension/origins.ts";
import { DEFAULT_SCOPES } from "@/lib/mcp/scopes.ts";
import { UNKNOWN_CLIENT } from "@clippings/shared";

import { isAllowlisted, parseAllowlist } from "./allowlist.ts";
import { authorizationRequestSource } from "./authorization-request.ts";
import { closedPage } from "./connection.ts";
import { NOT_ALLOWLISTED } from "./validate-user.ts";

const AUTHORIZE_PATH = "/oauth2/authorize";
const CONSENT_PATH = "/oauth2/consent";
const GATED_PATHS = new Set([AUTHORIZE_PATH, CONSENT_PATH]);

/** The authorization request's parameters, keeping the values that are strings. */
function stringParams(params: unknown): URLSearchParams {
  return new URLSearchParams(
    Object.entries(params ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** The request's `prompt` values with `consent` in place of `none`. */
function promptWithConsent(prompt: unknown): string {
  const values = new Set(typeof prompt === "string" ? prompt.split(" ").filter(Boolean) : []);
  values.delete("none");
  values.add("consent");
  return [...values].join(" ");
}

/**
 * Applies the allowlist to OAuth authorization, not only to sign-in. Sign-in already refuses an
 * account off the list, but a session outlives a change to `ALLOWED_EMAILS`. So both the
 * authorization endpoint (including the authorization resumed after sign-in or consent) and the
 * consent endpoint check the signed-in account again. Refresh tokens are checked where they're
 * used: `/mcp` checks the token's user on every request.
 *
 * An authorization the extension starts for a client this server doesn't know (after a database
 * restore or a branch reset, the extension still holds the old id) would end on the error page
 * in the sign-in window, which the extension can't tell from the user closing it. So it goes back
 * to the extension with `unknown_client`, signed in or not, and the extension registers a new
 * client. Only a trusted extension's redirect is answered this way, so the redirect never leaves
 * for another site and this can't be used to ask which client ids exist.
 *
 * An authorization that names no scope gets the default scopes. Without this the provider would
 * grant a client that asks for nothing every scope it knows, `clippings:write` included, and
 * the extension and any client that predates the write scope would silently gain it. The
 * provider reads an authorization's parameters from the query on GET and from the form body on
 * POST, so the gate reads and rewrites whichever the request used.
 *
 * It also makes every authorization ask: claude.ai's client id is one URL shared by every
 * claude.ai user, so a stored consent would let a link someone else started finish for this
 * user without a click. Claude connects rarely, so the page costs little.
 */
export function consentGate({
  allowedEmails,
  extensionIds,
}: {
  allowedEmails: string | undefined;
  extensionIds: readonly string[];
}) {
  const allowlist = parseAllowlist(allowedEmails);

  return {
    id: "clippings-consent-gate",
    hooks: {
      before: [
        {
          matcher: (context) => GATED_PATHS.has(context.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            // An authorization sent as a form (POST) carries its parameters in the body, but one
            // the consent page resumes has them in the query (see the helper).
            const { sent, inBody } = authorizationRequestSource(ctx);
            // What the authorization request is rewritten to, on the paths that carry on.
            const defaults: Record<string, string> = {};
            const carryOn = () => {
              if (Object.keys(defaults).length === 0) return undefined;
              const rewritten = { ...(sent as Record<string, unknown> | undefined), ...defaults };
              return { context: inBody ? { body: rewritten } : { query: rewritten } };
            };

            if (ctx.path === AUTHORIZE_PATH) {
              const query = stringParams(sent);
              if (!query.get("scope")?.trim()) defaults.scope = DEFAULT_SCOPES.join(" ");
              const clientId = query.get("client_id") ?? "";
              // A client id that is a URL names a metadata document (CIMD), resolved on demand,
              // not a registration; the extension registers.
              const registered = clientId !== "" && !URL.canParse(clientId);
              const back = registered
                ? extensionErrorRedirect(query, extensionIds, "invalid_client", UNKNOWN_CLIENT)
                : undefined;
              if (
                back &&
                !(await ctx.context.adapter.findOne({
                  model: "oauthClient",
                  where: [{ field: "clientId", value: clientId }],
                }))
              ) {
                throw ctx.redirect(back);
              }
            }

            const session = await getSessionFromCtx(ctx);
            // No session: the authorization endpoint sends the user to sign-in, where the
            // allowlist applies, and the consent endpoint refuses on its own.
            if (!session) return carryOn();

            if (!isAllowlisted(allowlist, session.user.email)) {
              if (ctx.path === AUTHORIZE_PATH) {
                // The extension's sign-in window closes on its redirect, and the popup says why.
                throw ctx.redirect(
                  extensionErrorRedirect(
                    stringParams(sent),
                    extensionIds,
                    "access_denied",
                    NOT_ALLOWLISTED,
                  ) ?? closedPage("private"),
                );
              }
              throw new APIError("FORBIDDEN", {
                error: "access_denied",
                error_description: "This account is not on the allowlist.",
              });
            }

            // Allowing on the consent page resumes the authorization inside the consent request;
            // asking again there would send the user back to the page they just answered.
            const answeringConsent = ctx.request?.url
              ? new URL(ctx.request.url).pathname.endsWith(CONSENT_PATH)
              : false;
            if (ctx.path === AUTHORIZE_PATH && !answeringConsent) {
              defaults.prompt = promptWithConsent(
                (sent as { prompt?: unknown } | undefined)?.prompt,
              );
            }
            return carryOn();
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
