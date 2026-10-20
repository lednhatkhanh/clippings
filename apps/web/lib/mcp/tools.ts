import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod";

import {
  InvalidTagsError,
  InvalidUrlError,
  NoteTooLongError,
  type ClippingsService,
} from "@clippings/db";
import {
  MAX_NOTE_LENGTH,
  MAX_QUERY_LENGTH,
  SEARCH_RESULT_LIMIT,
  type Clipping,
} from "@clippings/shared";

/** Who is calling: the token's user and the OAuth client it was issued to. */
export interface McpCaller {
  userId: string;
  clientId: string;
}

/** What the tools need from the Clippings service. */
export type McpClippings = Pick<
  ClippingsService,
  "saveClipping" | "searchClippings" | "listClippings"
>;

const DEFAULT_LIMIT = 10;

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(SEARCH_RESULT_LIMIT)
  .optional()
  .describe(
    `How many clippings to return, at most ${SEARCH_RESULT_LIMIT}. Defaults to ${DEFAULT_LIMIT}.`,
  );

/**
 * The caller, from the access token `/mcp` verified. A request without one never reaches a tool:
 * the route answers 401 first.
 */
export function callerFrom(ctx: ServerContext): McpCaller {
  const authInfo = ctx.http?.authInfo;
  const userId = authInfo?.extra?.userId;
  if (!authInfo || typeof userId !== "string" || !userId) {
    throw new Error("The MCP request has no verified user");
  }
  return { userId, clientId: authInfo.clientId };
}

/** A clipping as a tool returns it: what Claude needs to cite and link it. */
function present(clipping: Clipping, appOrigin: string) {
  return {
    id: clipping.id,
    url: clipping.url,
    title: clipping.title,
    note: clipping.note || null,
    summary: clipping.summary,
    tags: clipping.tags.map((tag) => tag.name),
    source: clipping.source,
    status: clipping.status,
    savedAt: clipping.createdAt,
    link: new URL(`/c/${clipping.id}`, appOrigin).toString(),
  };
}

const result = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const failure = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/**
 * Registers `save_clipping`, `search_clippings` and `list_recent`. Each one acts only for the
 * token's user, through the same service the web app uses, so the user's own rules (duplicate
 * detection, enrichment, per-user scoping) apply unchanged.
 */
export function registerClippingTools(
  server: McpServer,
  { clippings, appOrigin }: { clippings: McpClippings; appOrigin: string },
) {
  server.registerTool(
    "save_clipping",
    {
      title: "Save a clipping",
      description:
        "Save a web page to the user's Clippings, with an optional note on why it's worth keeping. Saving a URL that is already saved returns the existing clipping unchanged. Clippings reads the page in the background and adds a title and summary.",
      inputSchema: z.object({
        url: z.string().min(1).describe("The page's address (http or https)."),
        note: z
          .string()
          .max(MAX_NOTE_LENGTH)
          .optional()
          .describe("Why the user is keeping it, in their words."),
        source: z
          .enum(["mcp", "digest"])
          .optional()
          .describe('Leave out, or "digest" when saving from a digest of links.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ url, note, source }, ctx) => {
      const caller = callerFrom(ctx);
      try {
        const saved = await clippings.saveClipping(caller.userId, {
          url,
          note: note?.trim(),
          source: source ?? "mcp",
          clientId: caller.clientId,
        });
        return result({
          status: saved.status,
          clipping: present(saved.clipping, appOrigin),
        });
      } catch (error) {
        if (error instanceof InvalidUrlError)
          return failure("That isn't a web address Clippings can save.");
        if (error instanceof NoteTooLongError) return failure("That note is too long.");
        throw error;
      }
    },
  );

  server.registerTool(
    "search_clippings",
    {
      title: "Search clippings",
      description:
        'Search the user\'s saved clippings by keyword and meaning, best match first. The query takes web-search syntax: "a phrase", -without, this or that.',
      inputSchema: z.object({
        query: z.string().min(1).max(MAX_QUERY_LENGTH).describe("What to look for."),
        tags: z
          .array(z.string())
          .optional()
          .describe("Only clippings with every one of these tags."),
        limit: limitSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, tags, limit }, ctx) => {
      const caller = callerFrom(ctx);
      try {
        const { items } = await clippings.searchClippings(caller.userId, {
          q: query,
          tags,
          limit: limit ?? DEFAULT_LIMIT,
        });
        return result({ clippings: items.map((hit) => present(hit.clipping, appOrigin)) });
      } catch (error) {
        if (error instanceof InvalidTagsError) return failure(`${error.message}.`);
        throw error;
      }
    },
  );

  server.registerTool(
    "list_recent",
    {
      title: "List recent clippings",
      description: "List the user's most recently saved clippings, newest first.",
      inputSchema: z.object({ limit: limitSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }, ctx) => {
      const caller = callerFrom(ctx);
      const page = await clippings.listClippings(caller.userId, { limit: limit ?? DEFAULT_LIMIT });
      return result({ clippings: page.items.map((clipping) => present(clipping, appOrigin)) });
    },
  );
}
