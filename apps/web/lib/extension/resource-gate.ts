import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { authorizationRequestSource } from "@/lib/auth/authorization-request.ts";

import { isExtensionRedirectUri } from "./origins.ts";

const REGISTER_PATH = "/oauth2/register";
const AUTHORIZE_PATH = "/oauth2/authorize";

/** A query or body value that may be one string or several. */
const values = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string",
  );

const refuse = () =>
  new APIError("BAD_REQUEST", {
    error: "invalid_target",
    error_description: "Only the Clippings extension may use the extension API.",
  });

/**
 * Keeps the extension API's resource to the extension. Registration is open (Claude Code
 * registers itself), so without this any client could register for the resource and ask for a
 * token good there. Only a client whose every redirect is a trusted extension's may register for
 * it, and only an authorization that returns to one may ask for it (on GET or POST).
 */
export function extensionResourceGate({
  resource,
  extensionIds,
}: {
  resource: string;
  extensionIds: readonly string[];
}) {
  const returnsToExtension = (uris: string[]) =>
    uris.length > 0 && uris.every((uri) => isExtensionRedirectUri(uri, extensionIds));

  return {
    id: "clippings-extension-resource-gate",
    hooks: {
      before: [
        {
          matcher: (context) => context.path === REGISTER_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { resources?: unknown; redirect_uris?: unknown };
            if (!values(body.resources).includes(resource)) return;
            if (!returnsToExtension(values(body.redirect_uris))) throw refuse();
          }),
        },
        {
          matcher: (context) => context.path === AUTHORIZE_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            // The gate reads the parameters from the place the provider does.
            const sent = authorizationRequestSource(ctx).sent ?? {};
            const { resource: asked, redirect_uri: redirectUri } = sent as {
              resource?: unknown;
              redirect_uri?: unknown;
            };
            if (!values(asked).includes(resource)) return;
            if (!returnsToExtension(values(redirectUri))) throw refuse();
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
