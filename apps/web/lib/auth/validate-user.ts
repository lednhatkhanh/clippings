import type { BetterAuthOptions } from "better-auth";

import { isAllowlisted, normalizeEmail, parseAllowlist } from "./allowlist.ts";

/** Holds the email of the last rejected account for the not-allowlisted page to name. */
export const REJECTED_EMAIL_COOKIE = "clippings-rejected-email";

export const NOT_ALLOWLISTED = "not_allowlisted";

type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;

/**
 * Better Auth's `validateUserInfo` gate: it runs on first sign-in, when linking an account, and
 * on every later Google sign-in with the provider's fresh email, so removing an email from the
 * allowlist locks that person out at their next sign-in.
 *
 * The email travels in a short-lived cookie, not in the error redirect's query string, so it
 * stays out of browser history and access logs.
 */
export function createUserValidator({ allowedEmails }: { allowedEmails: string | undefined }) {
  const allowlist = parseAllowlist(allowedEmails);

  const validate: ValidateUserInfo = ({ user }, context) => {
    const email = typeof user.email === "string" ? user.email : undefined;
    if (isAllowlisted(allowlist, email)) return;

    if (email) {
      context.setCookie(REJECTED_EMAIL_COOKIE, normalizeEmail(email), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 300,
        path: "/",
      });
    }
    return { error: NOT_ALLOWLISTED, errorDescription: "This account is not on the allowlist." };
  };

  return validate;
}
