import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { createPool } from "@clippings/db";

import { createUserValidator } from "./validate-user";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function createAuth() {
  return betterAuth({
    // Neon's pooled URL; migrations use the direct URL (see `@clippings/db`).
    database: createPool(requireEnv("DATABASE_URL")),
    // `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are read from the environment by Better Auth.
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
    socialProviders: {
      google: {
        clientId: requireEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
        // Always show the account chooser, so "Use another account" can pick a different one.
        prompt: "select_account",
      },
    },
    user: {
      validateUserInfo: createUserValidator({ allowedEmails: process.env.ALLOWED_EMAILS }),
    },
    onAPIError: { errorURL: "/sign-in" },
    // Deliberately left at Better Auth's defaults, for a Google-only, allowlisted app:
    // - trustedOrigins: `BETTER_AUTH_URL` is trusted; previews don't sign in (spec, "Hosting").
    //   Add the extension's origin when its sign-in lands.
    // - rateLimit: on in production by default; the surface is one OAuth start and callback.
    // - accountLinking: one provider, and `validateUserInfo` also gates linking.
    // - email verification, passwords, 2FA: not enabled; there is no email/password sign-in.
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/**
 * Lazy, so `next build` doesn't need the runtime secrets and the root layout never touches
 * request data.
 */
export function getAuth() {
  return (instance ??= createAuth());
}
