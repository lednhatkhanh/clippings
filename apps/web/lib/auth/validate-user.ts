import type { BetterAuthOptions, GenericEndpointContext } from "better-auth";

import { isAllowlisted, normalizeEmail, parseAllowlist } from "./allowlist.ts";

/** Holds the email of the last rejected account for the not-allowlisted page to name. */
export const REJECTED_EMAIL_COOKIE = "clippings-rejected-email";

export const NOT_ALLOWLISTED = "not_allowlisted";

/** Remembers the rejected email for the not-allowlisted page, in a cookie rather than the URL. */
export function rememberRejectedEmail(
  context: Pick<GenericEndpointContext, "setCookie">,
  email: string,
) {
  context.setCookie(REJECTED_EMAIL_COOKIE, normalizeEmail(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 300,
    path: "/",
  });
}

type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;

/**
 * Better Auth's `validateUserInfo` gate: it runs on first sign-in, when linking an account, and
 * on every later Google sign-in with the provider's fresh profile. It accepts only an
 * allowlisted email that the provider reports as verified, since the allowlist trusts the
 * address. Removing an email from the allowlist ends the person's existing sessions too
 * (`allowlistGate`), not only their next sign-in.
 *
 * The email travels in a short-lived cookie, not in the error redirect's query string, so it
 * stays out of browser history and access logs.
 */
export function createUserValidator({ allowedEmails }: { allowedEmails: string | undefined }) {
  const allowlist = parseAllowlist(allowedEmails);

  const validate: ValidateUserInfo = ({ user }, context) => {
    const email = typeof user.email === "string" ? user.email : undefined;
    if (user.emailVerified === true && isAllowlisted(allowlist, email)) return;

    if (email) rememberRejectedEmail(context, email);
    return { error: NOT_ALLOWLISTED, errorDescription: "This account is not on the allowlist." };
  };

  return validate;
}
