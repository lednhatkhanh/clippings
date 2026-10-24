import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";

import { isAllowlisted, parseAllowlist } from "./allowlist.ts";
import { NOT_ALLOWLISTED, rememberRejectedEmail } from "./validate-user.ts";

const SESSION_PATH = "/get-session";
// Sign-out must still work for a revoked user, and the OAuth endpoints refuse on their own in
// `consentGate` (which sends the extension back with the reason).
const EXEMPT_PATHS = new Set([SESSION_PATH, "/sign-out", "/oauth2/authorize", "/oauth2/consent"]);
const EXEMPT_PREFIXES = ["/sign-in", "/callback"];

/**
 * Applies the allowlist to every session, not only at sign-in. A session outlives a change to
 * `ALLOWED_EMAILS` (it slides daily), so a person removed from the list would keep their access
 * until they signed out. Two hooks close that:
 *
 * - `/get-session` answers null for an account off the list, so the app's `getSession` (the
 *   layout's gate, every page and server action) sees no session.
 * - Every other endpoint under `/api/auth` (create-client, update-user, list-sessions and the
 *   rest) refuses with 403 for such a session.
 *
 * Either way the account's sessions are deleted on the spot and its session cookies cleared (the
 * cookie cache would otherwise keep answering for up to five minutes), even if a later request
 * skips these hooks.
 */
export function allowlistGate({ allowedEmails }: { allowedEmails: string | undefined }) {
  const allowlist = parseAllowlist(allowedEmails);

  return {
    id: "clippings-allowlist-gate",
    hooks: {
      before: [
        {
          matcher: (context) => {
            const path = context.path ?? "";
            return !EXEMPT_PATHS.has(path) && !EXEMPT_PREFIXES.some((p) => path.startsWith(p));
          },
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session || isAllowlisted(allowlist, session.user.email)) return;
            await ctx.context.internalAdapter.deleteUserSessions(session.user.id);
            deleteSessionCookie(ctx);
            rememberRejectedEmail(ctx, session.user.email);
            throw new APIError("FORBIDDEN", {
              error: "access_denied",
              error_description: "This account is not on the allowlist.",
              message: NOT_ALLOWLISTED,
            });
          }),
        },
      ],
      after: [
        {
          matcher: (context) => context.path === SESSION_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as
              | { user?: { id: string; email?: string } }
              | null
              | undefined;
            if (!returned?.user || isAllowlisted(allowlist, returned.user.email)) return;
            await ctx.context.internalAdapter.deleteUserSessions(returned.user.id);
            // As Better Auth's own null answer does: the cookies go too, the session cookie
            // cache among them, and the sign-in page can name the account.
            deleteSessionCookie(ctx);
            if (returned.user.email) rememberRejectedEmail(ctx, returned.user.email);
            return ctx.json(null);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
