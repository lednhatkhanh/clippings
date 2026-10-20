import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import { isAllowlisted, parseAllowlist } from "./allowlist.ts";
import { closedPage } from "./connection.ts";

const AUTHORIZE_PATH = "/oauth2/authorize";
const CONSENT_PATH = "/oauth2/consent";
const GATED_PATHS = new Set([AUTHORIZE_PATH, CONSENT_PATH]);

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
 * It also makes every authorization ask: claude.ai's client id is one URL shared by every
 * claude.ai user, so a stored consent would let a link someone else started finish for this
 * user without a click. Claude connects rarely, so the page costs little.
 */
export function consentGate({ allowedEmails }: { allowedEmails: string | undefined }) {
  const allowlist = parseAllowlist(allowedEmails);

  return {
    id: "clippings-consent-gate",
    hooks: {
      before: [
        {
          matcher: (context) => GATED_PATHS.has(context.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            // No session: the authorization endpoint sends the user to sign-in, where the
            // allowlist applies, and the consent endpoint refuses on its own.
            if (!session) return;

            if (!isAllowlisted(allowlist, session.user.email)) {
              if (ctx.path === AUTHORIZE_PATH) throw ctx.redirect(closedPage("private"));
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
              return {
                context: { query: { ...ctx.query, prompt: promptWithConsent(ctx.query?.prompt) } },
              };
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
