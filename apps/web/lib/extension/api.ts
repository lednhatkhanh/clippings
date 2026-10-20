import { isAPIError } from "better-auth/api";
import {
  createDpopReplayStore,
  requestToResourceInput,
  verifyAccessTokenRequest,
} from "better-auth/oauth2";
import type * as z from "zod";

import { isAllowlisted, parseAllowlist } from "@/lib/auth/allowlist.ts";
import type { createAuth } from "@/lib/auth/auth.ts";
import { InvalidUrlError, NoteTooLongError, type ClippingsService } from "@clippings/db";
import {
  extensionNoteRequestSchema,
  extensionSaveRequestSchema,
  type Clipping,
  type ExtensionApiError,
  type ExtensionClipping,
  type ExtensionSaveResponse,
} from "@clippings/shared";

import { extensionOrigin } from "./origins.ts";

/** What the API needs from the Clippings service. */
export type ExtensionClippings = Pick<ClippingsService, "saveClipping" | "updateClipping">;

/** Who is calling: the token's user and the OAuth client (the extension install) it went to. */
interface Caller {
  userId: string;
  clientId: string;
}

const ALLOWED_METHODS = "POST, PATCH";
const ALLOWED_HEADERS = "authorization, content-type";

/**
 * The extension's REST API: it saves the current page and edits its note, for the user its bearer
 * token acts for. Only the token counts: cookies are never read, so a page the user visits can't
 * act through their web session, and no answer sets one. CORS lets the trusted extensions' origins
 * in; the service worker could call without it, since it holds a host permission, but the API
 * doesn't rely on that.
 */
export function createExtensionApi({
  auth,
  clippings,
  resource,
  allowedEmails,
  extensionIds,
}: {
  auth: ReturnType<typeof createAuth>;
  clippings: ExtensionClippings;
  /** The resource identifier the extension's tokens are issued for. */
  resource: string;
  allowedEmails: string | undefined;
  extensionIds: readonly string[];
}) {
  const allowlist = parseAllowlist(allowedEmails);
  const origins = new Set(extensionIds.map(extensionOrigin));
  const appOrigin = new URL(resource).origin;

  /** CORS headers for a trusted extension's origin; none for anyone else. */
  function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");
    const vary = { vary: "Origin" };
    return origin && origins.has(origin)
      ? { ...vary, "access-control-allow-origin": origin }
      : vary;
  }

  function reply(request: Request, body: unknown, status: number, extra?: HeadersInit) {
    const headers = new Headers(extra);
    for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
    headers.set("cache-control", "no-store");
    return Response.json(body, { status, headers });
  }

  const refuse = (
    request: Request,
    status: number,
    error: ExtensionApiError,
    extra?: HeadersInit,
  ) => reply(request, { error }, status, extra);

  /**
   * The caller from the request's bearer token, verified against the app's signing keys and bound
   * to the extension API: a `/mcp` token is refused here. The user must still be on the allowlist,
   * since a refresh token outlives a change to it.
   */
  async function authenticate(request: Request): Promise<Caller | Response> {
    const context = await auth.$context;
    let claims: Awaited<ReturnType<typeof verifyAccessTokenRequest>>;
    try {
      claims = await verifyAccessTokenRequest(requestToResourceInput(request), {
        verifyOptions: { issuer: context.baseURL, audience: resource },
        jwksUrl: `${context.baseURL}/jwks`,
        dpop: { replayStore: createDpopReplayStore(context.internalAdapter) },
      });
    } catch (error) {
      // A refused token (or DPoP proof) is a 4xx API error. Anything else, such as the signing
      // keys being unreachable, is the server's problem: a 401 would make the extension spend
      // its refresh token and then sign the user out.
      if (!isAPIError(error) || error.statusCode >= 500) throw error;
      const challenge = request.headers.has("authorization")
        ? 'Bearer error="invalid_token"'
        : "Bearer";
      return refuse(request, 401, "invalid_token", { "www-authenticate": challenge });
    }

    const clientId = claims.azp ?? claims.client_id;
    // Bound to this API alone: a token for several resources (`aud` as a list) is refused even
    // when this API is one of them. A token without a user names the client as its subject.
    const audience =
      Array.isArray(claims.aud) && claims.aud.length === 1 ? claims.aud[0] : claims.aud;
    if (
      audience !== resource ||
      typeof clientId !== "string" ||
      typeof claims.sub !== "string" ||
      claims.sub === clientId
    ) {
      return refuse(request, 401, "invalid_token", {
        "www-authenticate": 'Bearer error="invalid_token"',
      });
    }
    const user = await context.internalAdapter.findUserById(claims.sub);
    if (!isAllowlisted(allowlist, user?.email)) return refuse(request, 403, "not_allowlisted");
    return { userId: claims.sub, clientId };
  }

  /** The request's JSON body, if it matches the schema. */
  async function readBody<Schema extends z.ZodType>(
    request: Request,
    schema: Schema,
  ): Promise<z.infer<Schema> | undefined> {
    try {
      const parsed = schema.safeParse(await request.json());
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  const present = (clipping: Clipping): ExtensionClipping => ({
    id: clipping.id,
    url: clipping.url,
    title: clipping.title,
    note: clipping.note,
    createdAt: clipping.createdAt,
    link: new URL(`/c/${clipping.id}`, appOrigin).toString(),
  });

  return {
    /** The CORS preflight: a trusted extension may send its token and JSON. */
    preflight(request: Request): Response {
      const cors = corsHeaders(request);
      if (!("access-control-allow-origin" in cors)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-methods": ALLOWED_METHODS,
          "access-control-allow-headers": ALLOWED_HEADERS,
          "access-control-max-age": "600",
        },
      });
    },

    /**
     * Saves the page with source `extension`, or finds it when the user has saved it already: the
     * popup shows "Saved" for a new clipping and "Saved on <date>" with its note for an old one.
     */
    async save(request: Request): Promise<Response> {
      const caller = await authenticate(request);
      if (caller instanceof Response) return caller;
      const body = await readBody(request, extensionSaveRequestSchema);
      if (!body) return refuse(request, 400, "invalid_request");

      try {
        const saved = await clippings.saveClipping(caller.userId, {
          url: body.url,
          source: "extension",
          clientId: caller.clientId,
        });
        const answer: ExtensionSaveResponse = {
          status: saved.status,
          clipping: present(saved.clipping),
        };
        return reply(request, answer, saved.status === "created" ? 201 : 200);
      } catch (error) {
        if (error instanceof InvalidUrlError) return refuse(request, 400, "invalid_url");
        throw error;
      }
    },

    /** Replaces the note on one of the caller's clippings. */
    async updateNote(request: Request, clippingId: string): Promise<Response> {
      const caller = await authenticate(request);
      if (caller instanceof Response) return caller;
      const body = await readBody(request, extensionNoteRequestSchema);
      if (!body) return refuse(request, 400, "invalid_request");

      try {
        const updated = await clippings.updateClipping(caller.userId, clippingId, {
          note: body.note,
        });
        return updated ? reply(request, present(updated), 200) : refuse(request, 404, "not_found");
      } catch (error) {
        // The schema caps the note already; this is the service's own check agreeing.
        if (error instanceof NoteTooLongError) return refuse(request, 400, "invalid_request");
        throw error;
      }
    },
  };
}

export type ExtensionApi = ReturnType<typeof createExtensionApi>;
