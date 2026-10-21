import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";
import {
  MAX_NOTE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CLIPPING,
  MAX_TITLE_LENGTH,
} from "@clippings/shared";

import { createClippingsMcpHandler } from "./handler.ts";
import { WRITE_SCOPE } from "./scopes.ts";
import type { McpCaller } from "./tools.ts";

const WRITE_TOOLS = [
  "delete_clipping",
  "get_clipping",
  "list_tags",
  "restore_clipping",
  "update_clipping",
];
const READ_TOOLS = ["list_recent", "save_clipping", "search_clippings"];

interface ToolClipping {
  id: string;
  url: string;
  title: string;
  pageTitle?: string;
  excerpt: string | null;
  tags: string[];
  note: string | null;
  source: string;
  link: string;
}

describe.skipIf(!TEST_DATABASE_URL)("the MCP tools", () => {
  let fixture: ServiceFixture;
  let handler: (request: Request) => Promise<Response>;
  let ada: McpCaller;
  let bob: McpCaller;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    handler = createClippingsMcpHandler({
      clippings: fixture.service,
      appOrigin: "https://clippings.test",
    });
    ada = { userId: await fixture.createUser("ada"), clientId: "https://claude.ai/oauth/mcp" };
    bob = { userId: await fixture.createUser("bob"), clientId: "claude-code-client" };
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Sends one JSON-RPC request to `/mcp` as `caller`, the way the route does once the token checks out. */
  async function rpc(
    caller: McpCaller,
    method: string,
    params: Record<string, unknown>,
    scopes: string[] = [WRITE_SCOPE],
  ) {
    const request = new Request("https://clippings.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    request.auth = {
      token: "verified",
      clientId: caller.clientId,
      scopes,
      extra: { userId: caller.userId },
    };
    const response = await handler(request);
    const body = await response.text();
    // A JSON body, or one server-sent event carrying it.
    const json = body.startsWith("{") ? body : (body.match(/^data: (.*)$/m)?.[1] ?? "");
    return JSON.parse(json) as {
      result?: { content: { type: string; text: string }[]; isError?: boolean; tools?: unknown[] };
      error?: unknown;
    };
  }

  async function callTool(
    caller: McpCaller,
    name: string,
    args: Record<string, unknown>,
    scopes?: string[],
  ) {
    const response = await rpc(caller, "tools/call", { name, arguments: args }, scopes);
    const result = response.result;
    if (!result) throw new Error(`No result: ${JSON.stringify(response)}`);
    const text = result.content[0]?.text ?? "";
    return { isError: result.isError ?? false, text, json: () => JSON.parse(text) };
  }

  async function toolsFor(scopes: string[]) {
    const response = await rpc(ada, "tools/list", {}, scopes);
    return (response.result?.tools ?? []) as {
      name: string;
      annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean };
    }[];
  }

  it("lists only the three save and search tools to a token without the write scope", async () => {
    for (const scopes of [[], ["openid", "profile", "email", "offline_access"]]) {
      const names = (await toolsFor(scopes)).map((tool) => tool.name);
      expect(names.sort()).toEqual(READ_TOOLS);
    }
  });

  it("adds the write tools for a token with the write scope", async () => {
    const tools = await toolsFor(["openid", WRITE_SCOPE]);
    expect(tools.map((tool) => tool.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    expect(tools.find((tool) => tool.name === "delete_clipping")?.annotations).toMatchObject({
      destructiveHint: true,
    });
    for (const tool of tools.filter((tool) => tool.name !== "delete_clipping")) {
      expect(tool.annotations?.destructiveHint).not.toBe(true);
    }
  });

  it("refuses a write tool called without the write scope, and changes nothing", async () => {
    const saved = (
      await callTool(ada, "save_clipping", { url: "https://example.com/keep" })
    ).json() as {
      clipping: ToolClipping;
    };
    const id = saved.clipping.id;

    const calls: [string, Record<string, unknown>][] = [
      ["get_clipping", { id }],
      ["update_clipping", { id, title: "Renamed", note: "changed", tags: ["x"] }],
      ["list_tags", {}],
      ["delete_clipping", { id }],
      ["restore_clipping", { id }],
    ];
    for (const [name, args] of calls) {
      const response = await rpc(ada, "tools/call", { name, arguments: args }, []);
      // Not a tool result: the server doesn't know the tool at all.
      expect(response.result?.content?.[0]?.text ?? "").not.toContain(id);
      expect(response.error ?? response.result?.isError).toBeTruthy();
    }

    expect(await fixture.service.getClipping(ada.userId, id)).toMatchObject({
      note: "",
      title: "https://example.com/keep",
      tags: [],
    });
  });

  it("saves a clipping with source mcp and the calling client recorded", async () => {
    const saved = await callTool(ada, "save_clipping", {
      url: "https://example.com/pricing",
      note: "How they charge",
    });

    const { status, clipping } = saved.json() as { status: string; clipping: ToolClipping };
    expect(status).toBe("created");
    expect(clipping.source).toBe("mcp");
    expect(clipping.note).toBe("How they charge");
    expect(clipping.link).toBe(`https://clippings.test/c/${clipping.id}`);

    const stored = await fixture.service.getClipping(ada.userId, clipping.id);
    expect(stored?.source).toBe("mcp");
    expect(stored?.clientId).toBe(ada.clientId);
  });

  it("accepts digest as the source", async () => {
    const saved = await callTool(ada, "save_clipping", {
      url: "https://example.com/digest-link",
      source: "digest",
    });
    expect((saved.json() as { clipping: ToolClipping }).clipping.source).toBe("digest");
  });

  it("finds an existing clipping instead of saving it twice", async () => {
    await callTool(ada, "save_clipping", { url: "https://example.com/a", note: "first" });
    const again = await callTool(ada, "save_clipping", {
      url: "https://example.com/a/",
      note: "second",
    });
    const { status, clipping } = again.json() as { status: string; clipping: ToolClipping };
    expect(status).toBe("existing");
    expect(clipping.note).toBe("first");
  });

  it("answers an address it can't save with a tool error", async () => {
    const saved = await callTool(ada, "save_clipping", { url: "not a url" });
    expect(saved.isError).toBe(true);
  });

  it("only ever touches the token owner's clippings", async () => {
    await callTool(ada, "save_clipping", { url: "https://example.com/ada-secret", note: "zebra" });
    fixture.advanceClock(60_000);
    await callTool(bob, "save_clipping", { url: "https://example.com/bob-page", note: "zebra" });

    const bobsRecent = (await callTool(bob, "list_recent", {})).json() as {
      clippings: ToolClipping[];
    };
    expect(bobsRecent.clippings.map((clipping) => clipping.url)).toEqual([
      "https://example.com/bob-page",
    ]);

    const bobsSearch = (await callTool(bob, "search_clippings", { query: "zebra" })).json() as {
      clippings: ToolClipping[];
    };
    expect(bobsSearch.clippings.map((clipping) => clipping.url)).toEqual([
      "https://example.com/bob-page",
    ]);

    // Saving Ada's URL as Bob makes Bob's own clipping, and leaves Ada's alone.
    const bobsCopy = (
      await callTool(bob, "save_clipping", { url: "https://example.com/ada-secret" })
    ).json() as { status: string; clipping: ToolClipping };
    expect(bobsCopy.status).toBe("created");
    expect(bobsCopy.clipping.note).toBeNull();

    const adasRecent = (await callTool(ada, "list_recent", {})).json() as {
      clippings: ToolClipping[];
    };
    expect(adasRecent.clippings.map((clipping) => clipping.note)).toEqual(["zebra"]);
  });

  it("searches within tags and respects the limit", async () => {
    await callTool(ada, "save_clipping", { url: "https://example.com/one", note: "otter one" });
    fixture.advanceClock(60_000);
    await callTool(ada, "save_clipping", { url: "https://example.com/two", note: "otter two" });

    const limited = (
      await callTool(ada, "search_clippings", { query: "otter", limit: 1 })
    ).json() as {
      clippings: ToolClipping[];
    };
    expect(limited.clippings).toHaveLength(1);

    const tagged = (
      await callTool(ada, "search_clippings", { query: "otter", tags: ["animals"] })
    ).json() as { clippings: ToolClipping[] };
    expect(tagged.clippings).toEqual([]);

    const recent = (await callTool(ada, "list_recent", { limit: 1 })).json() as {
      clippings: ToolClipping[];
    };
    expect(recent.clippings.map((clipping) => clipping.url)).toEqual(["https://example.com/two"]);
  });

  it("lists a pinned clipping among the recent ones by when it was saved", async () => {
    const saved: ToolClipping[] = [];
    for (const name of ["one", "two", "three"]) {
      const created = await callTool(ada, "save_clipping", { url: `https://example.com/${name}` });
      saved.push((created.json() as { clipping: ToolClipping }).clipping);
      fixture.advanceClock(60_000);
    }
    await fixture.service.setPinned(ada.userId, saved[1]!.id, true);

    const recent = (await callTool(ada, "list_recent", {})).json() as { clippings: ToolClipping[] };
    expect(recent.clippings.map((clipping) => clipping.url)).toEqual([
      "https://example.com/three",
      "https://example.com/two",
      "https://example.com/one",
    ]);

    const limited = (await callTool(ada, "list_recent", { limit: 2 })).json() as {
      clippings: ToolClipping[];
    };
    expect(limited.clippings.map((clipping) => clipping.url)).toEqual([
      "https://example.com/three",
      "https://example.com/two",
    ]);
  });

  describe("with the write scope", () => {
    async function save(caller: McpCaller, url: string, note?: string) {
      const saved = await callTool(caller, "save_clipping", { url, note });
      return (saved.json() as { clipping: ToolClipping }).clipping;
    }

    it("reads one clipping in full, with the page's title when it was renamed", async () => {
      fixture.web.set("https://example.com/essay", {
        page: { title: "Essay | Example", text: "A long essay about gardening." },
        summary: {
          title: "An essay about gardening",
          summary: "Why small gardens beat big ones.",
          excerpt: "A long essay about gardening",
        },
      });
      const { id } = await save(ada, "https://example.com/essay", "for the bed");
      await fixture.service.enrichClipping(id);

      const plain = (await callTool(ada, "get_clipping", { id })).json() as {
        clipping: ToolClipping & { summary: string };
      };
      expect(plain.clipping).toMatchObject({
        id,
        title: "An essay about gardening",
        note: "for the bed",
        summary: "Why small gardens beat big ones.",
        excerpt: "A long essay about gardening",
        link: `https://clippings.test/c/${id}`,
      });
      expect(plain.clipping.pageTitle).toBeUndefined();

      await callTool(ada, "update_clipping", { id, title: "Garden plan" });
      const renamed = (await callTool(ada, "get_clipping", { id })).json() as {
        clipping: ToolClipping;
      };
      expect(renamed.clipping).toMatchObject({
        title: "Garden plan",
        pageTitle: "An essay about gardening",
      });
    });

    it("keeps users apart: another user's clipping is not found, read, changed or deleted", async () => {
      const { id } = await save(ada, "https://example.com/ada-only", "private");

      for (const [name, args] of [
        ["get_clipping", { id }],
        ["update_clipping", { id, title: "Mine now", note: "mine", tags: ["bob"] }],
        ["delete_clipping", { id }],
        ["restore_clipping", { id }],
      ] as const) {
        const refused = await callTool(bob, name, args);
        expect(refused.isError).toBe(true);
        expect(refused.text).not.toContain("private");
      }
      expect(await fixture.service.getClipping(ada.userId, id)).toMatchObject({
        note: "private",
        tags: [],
      });
      expect(await fixture.service.getClipping(bob.userId, id)).toBeNull();

      // Deleted by its owner, it still isn't Bob's to bring back.
      await callTool(ada, "delete_clipping", { id });
      expect((await callTool(bob, "restore_clipping", { id })).isError).toBe(true);
      expect(await fixture.service.getClipping(ada.userId, id)).toBeNull();
    });

    it("says it can't find an id that isn't a clipping", async () => {
      for (const id of ["not-an-id", "00000000-0000-4000-8000-000000000000"]) {
        expect((await callTool(ada, "get_clipping", { id })).isError).toBe(true);
        expect((await callTool(ada, "update_clipping", { id, note: "x" })).isError).toBe(true);
        expect((await callTool(ada, "delete_clipping", { id })).isError).toBe(true);
      }
    });

    it("sets the full list of tags, so a tag left out is removed and a retry adds nothing", async () => {
      const { id } = await save(ada, "https://example.com/tagged");

      const tagged = (
        await callTool(ada, "update_clipping", { id, tags: ["css", "layout"] })
      ).json() as {
        clipping: ToolClipping;
      };
      expect(tagged.clipping.tags.sort()).toEqual(["css", "layout"]);

      const replaced = (
        await callTool(ada, "update_clipping", { id, tags: ["layout", "grid"] })
      ).json() as {
        clipping: ToolClipping;
      };
      expect(replaced.clipping.tags.sort()).toEqual(["grid", "layout"]);
      const retried = (
        await callTool(ada, "update_clipping", { id, tags: ["layout", "grid"] })
      ).json() as {
        clipping: ToolClipping;
      };
      expect(retried.clipping.tags.sort()).toEqual(["grid", "layout"]);

      const cleared = (await callTool(ada, "update_clipping", { id, tags: [] })).json() as {
        clipping: ToolClipping;
      };
      expect(cleared.clipping.tags).toEqual([]);
    });

    it("leaves what isn't named alone, and refuses an update that names nothing", async () => {
      const { id } = await save(ada, "https://example.com/partial", "first note");
      await callTool(ada, "update_clipping", { id, tags: ["keep"] });

      const noted = (
        await callTool(ada, "update_clipping", { id, note: "second note" })
      ).json() as {
        clipping: ToolClipping;
      };
      expect(noted.clipping).toMatchObject({ note: "second note", tags: ["keep"] });

      expect((await callTool(ada, "update_clipping", { id })).isError).toBe(true);
    });

    it("renames to the user's title and resets to the page title with an empty one or null", async () => {
      fixture.web.set("https://example.com/page", {
        page: { title: "Page", text: "Some text." },
        summary: { title: "The page's title", summary: "S.", excerpt: "E" },
      });
      const { id } = await save(ada, "https://example.com/page");
      await fixture.service.enrichClipping(id);

      const renamed = (await callTool(ada, "update_clipping", { id, title: "  Mine " })).json() as {
        clipping: ToolClipping;
      };
      expect(renamed.clipping.title).toBe("Mine");

      // Claude sees the user's title in search and in recent, as the user does.
      const found = (await callTool(ada, "search_clippings", { query: "Mine" })).json() as {
        clippings: ToolClipping[];
      };
      expect(found.clippings.map((clipping) => clipping.title)).toEqual(["Mine"]);
      const recent = (await callTool(ada, "list_recent", {})).json() as {
        clippings: ToolClipping[];
      };
      expect(recent.clippings.map((clipping) => clipping.title)).toEqual(["Mine"]);

      for (const title of ["", null]) {
        await callTool(ada, "update_clipping", { id, title: "Mine" });
        const reset = (await callTool(ada, "update_clipping", { id, title })).json() as {
          clipping: ToolClipping;
        };
        expect(reset.clipping.title).toBe("The page's title");
        expect(reset.clipping.pageTitle).toBeUndefined();
      }
    });

    it("applies the web app's limits as tool errors", async () => {
      const { id } = await save(ada, "https://example.com/limits");

      for (const changes of [
        { title: "x".repeat(MAX_TITLE_LENGTH + 1) },
        { note: "x".repeat(MAX_NOTE_LENGTH + 1) },
        { tags: ["x".repeat(MAX_TAG_LENGTH + 1)] },
        { tags: Array.from({ length: MAX_TAGS_PER_CLIPPING + 1 }, (_, index) => `tag ${index}`) },
      ]) {
        expect((await callTool(ada, "update_clipping", { id, ...changes })).isError).toBe(true);
      }
      expect(await fixture.service.getClipping(ada.userId, id)).toMatchObject({
        note: "",
        tags: [],
      });
    });

    it("lists the user's tags with their clipping counts, and only theirs", async () => {
      const one = await save(ada, "https://example.com/one");
      const two = await save(ada, "https://example.com/two");
      await callTool(ada, "update_clipping", { id: one.id, tags: ["css", "grid"] });
      await callTool(ada, "update_clipping", { id: two.id, tags: ["css"] });
      const bobs = await save(bob, "https://example.com/bobs");
      await callTool(bob, "update_clipping", { id: bobs.id, tags: ["secret"] });

      const { tags } = (await callTool(ada, "list_tags", {})).json() as {
        tags: { name: string; clippings: number }[];
      };
      expect(tags).toEqual([
        { name: "css", clippings: 2 },
        { name: "grid", clippings: 1 },
      ]);
    });

    it("deletes a clipping out of every read and restores it with its note and tags", async () => {
      const { id } = await save(ada, "https://example.com/doomed", "remember");
      await callTool(ada, "update_clipping", { id, tags: ["x"] });

      const deleted = (await callTool(ada, "delete_clipping", { id })).json() as {
        deleted: boolean;
        id: string;
      };
      expect(deleted).toMatchObject({ deleted: true, id });
      expect((await callTool(ada, "get_clipping", { id })).isError).toBe(true);
      const recent = (await callTool(ada, "list_recent", {})).json() as {
        clippings: ToolClipping[];
      };
      expect(recent.clippings).toEqual([]);
      // Already deleted.
      expect((await callTool(ada, "delete_clipping", { id })).isError).toBe(true);

      const restored = (await callTool(ada, "restore_clipping", { id })).json() as {
        clipping: ToolClipping;
      };
      expect(restored.clipping).toMatchObject({ id, note: "remember", tags: ["x"] });
      expect(await fixture.service.getClipping(ada.userId, id)).not.toBeNull();
      // Not deleted any more.
      expect((await callTool(ada, "restore_clipping", { id })).isError).toBe(true);
    });
  });
});
