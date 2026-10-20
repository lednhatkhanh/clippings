import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";

import { getDatabase } from "@/lib/db.ts";
import {
  extensionOrigin,
  extensionResourceUrl,
  parseExtensionIds,
} from "@/lib/extension/origins.ts";
import { mcpResourceUrl } from "@/lib/mcp/resource.ts";
import {
  account,
  type Database,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  session,
  user,
  verification,
} from "@clippings/db";

import { consentGate } from "./consent-gate.ts";
import { isAllowedRedirectUri } from "./oauth-redirects.ts";
import { createUserValidator } from "./validate-user.ts";

/** Where the OAuth provider sends a user to sign in, and to allow or deny a client. */
export const OAUTH_LOGIN_PAGE = "/sign-in";
export const OAUTH_CONSENT_PAGE = "/connect";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** What the auth instance is built from. The app reads it from the environment. */
export interface AuthSetup {
  database: Database;
  /** The app's public origin. */
  baseURL: string;
  secret?: string;
  allowedEmails: string | undefined;
  google: { clientId: string; clientSecret: string };
  /** The browser extensions that may sign in, by id. */
  extensionIds: readonly string[];
}

export function createAuth({
  database,
  baseURL,
  secret,
  allowedEmails,
  google,
  extensionIds,
}: AuthSetup) {
  const extensionResource = extensionResourceUrl(baseURL);
  return betterAuth({
    baseURL,
    secret,
    // `BETTER_AUTH_URL` is trusted on its own; the extension's service worker calls the token
    // endpoint from its own origin.
    trustedOrigins: extensionIds.map(extensionOrigin),
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        user,
        session,
        account,
        verification,
        jwks,
        oauthClient,
        oauthResource,
        oauthClientResource,
        oauthRefreshToken,
        oauthAccessToken,
        oauthConsent,
        oauthClientAssertion,
      },
    }),
    // The JWT plugin's session-to-JWT endpoint: nothing here uses it, and OAuth issues the tokens.
    disabledPaths: ["/token"],
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
    socialProviders: {
      google: {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        // Always show the account chooser, so "Use another account" can pick a different one.
        prompt: "select_account",
      },
    },
    user: {
      validateUserInfo: createUserValidator({ allowedEmails }),
    },
    onAPIError: { errorURL: "/sign-in" },
    // Deliberately left at Better Auth's defaults, for a Google-only, allowlisted app:
    // - trustedOrigins: `BETTER_AUTH_URL` and the extension; previews don't sign in (spec,
    //   "Hosting").
    // - rateLimit: on in production by default; the surface is one OAuth start and callback.
    // - accountLinking: one provider, and `validateUserInfo` also gates linking.
    // - email verification, passwords, 2FA: not enabled; there is no email/password sign-in.
    plugins: [
      // Signs access tokens, and serves the keys `/mcp` verifies them with. No JWT on every
      // session lookup: nothing reads it, and it would sign one per page.
      jwt({ disableSettingJwtHeader: true }),
      // The OAuth 2.1 authorization server for Claude (claude.ai connectors and Claude Code)
      // and the extension: RFC 8414 and RFC 9728 metadata, PKCE S256, refresh-token rotation,
      // and access tokens bound to `/mcp` or to the extension API. Scopes stay at the defaults,
      // which include `offline_access`, so a client that asks for none gets a refresh token.
      mcp({
        loginPage: OAUTH_LOGIN_PAGE,
        consentPage: OAUTH_CONSENT_PAGE,
        resource: mcpResourceUrl(baseURL),
        // The extension registers for its API's resource as well as `/mcp`, which every new
        // client is linked to, and asks for tokens bound to it.
        resources: [extensionResource],
        clientRegistrationAllowedResources: [extensionResource],
        // Tokens always act for a user: no client-credentials grant.
        grantTypes: ["authorization_code", "refresh_token"],
        // Dynamic registration as well as metadata documents: clients that predate CIMD still
        // register, and `infer` lets one with a loopback redirect register as native.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
        // However a client registered, it gets the code only at claude.ai, a loopback port or a
        // trusted extension.
        validateRedirectUri: (uri, _registered, defaultResult) =>
          defaultResult && isAllowedRedirectUri(uri, extensionIds),
      }),
      // Client ID Metadata Documents, preferred over registration: a client's id is the URL of
      // its metadata, fetched with a transport that refuses private addresses and redirects.
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      consentGate({ allowedEmails, extensionIds }),
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/**
 * Lazy, so `next build` doesn't need the runtime secrets and the root layout never touches
 * request data.
 */
export function getAuth() {
  return (instance ??= createAuth({
    // Neon's pooled URL, shared with the Clippings service; migrations use the direct URL.
    database: getDatabase(),
    baseURL: requireEnv("BETTER_AUTH_URL"),
    // Better Auth reads `BETTER_AUTH_SECRET` itself when this is left out.
    secret: process.env.BETTER_AUTH_SECRET,
    allowedEmails: process.env.ALLOWED_EMAILS,
    google: {
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    },
    extensionIds: parseExtensionIds(process.env.EXTENSION_IDS),
  }));
}
