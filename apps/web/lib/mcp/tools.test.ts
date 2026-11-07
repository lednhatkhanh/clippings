import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleLibrarianJob } from "@/lib/librarian/job-request.ts";
import type { LibraryIndex } from "@/lib/librarian/library-index.ts";
import { EMPTY_PLAN, type LibraryPlan } from "@/lib/librarian/plan.ts";
import type { Planner } from "@/lib/librarian/planner.ts";
import { createLibrarianRunner } from "@/lib/librarian/run.ts";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";
import {
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CLIPPING,
  MAX_TITLE_LENGTH,
} from "@clippings/shared";

import { createClippingsMcpHandler } from "./handler.ts";
import { WRITE_SCOPE } from "./scopes.ts";
import type { McpCaller } from "./tools.ts";

const WRITE_TOOLS = [
  "accept_tag_suggestions",
  "apply_suggestion",
  "create_folder",
  "delete_clipping",
  "dismiss_suggestion",
  "dismiss_tag_suggestions",
  "get_clipping",
  "get_page_text",
  "link_items",
  "list_folders",
  "list_suggestions",
  "list_tag_suggestions",
  "list_tags",
  "merge_tag",
  "move_to_folder",
  "rename_tag",
  "restore_clipping",
  "run_librarian",
  "save_note",
  "set_tag_color",
  "tag_clippings",
  "undo_change",
  "update_clipping",
];
const READ_TOOLS = [
  "list_clippings",
  "list_recent",
  "related_clippings",
  "save_clipping",
  "search_clippings",
];

interface ToolClipping {
  id: string;
  kind: "link" | "note";
  url: string | null;
  body?: string | null;
  title: string;
  pageTitle?: string;
  excerpt: string | null;
  tags: string[];
  suggestedTags?: string[];
  pinned?: boolean;
  note: string | null;
  source: string;
  savedAt: string;
  link: string;
}

describe.skipIf(!TEST_DATABASE_URL)("the MCP tools", () => {
  let fixture: ServiceFixture;
  let handler: (request: Request) => Promise<Response>;
  let ada: McpCaller;
  let bob: McpCaller;
  /** The user ids whose libraries the planner was given, in order. */
  let planned: string[];
  /** The plan the librarian's planner returns for a library. */
  let planFor: (index: LibraryIndex) => LibraryPlan;
  let runner: ReturnType<typeof createLibrarianRunner>;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    planned = [];
    planFor = () => EMPTY_PLAN;
    const planner: Planner = {
      plan: async (userId, index) => {
        planned.push(userId);
        return { plan: planFor(index), capReached: false, notices: [], costMicros: 0 };
      },
    };
    runner = createLibrarianRunner({
      librarian: fixture.librarian,
      planner,
      now: () => fixture.clock.now(),
    });
    handler = createClippingsMcpHandler({
      clippings: fixture.service,
      librarian: fixture.librarian,
      research: fixture.research,
      runner,
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
      result?: {
        content: { type: string; text: string }[];
        structuredContent?: unknown;
        isError?: boolean;
        tools?: unknown[];
      };
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
    return {
      isError: result.isError ?? false,
      text,
      structured: result.structuredContent,
      json: () => JSON.parse(text),
    };
  }

  async function toolsFor(scopes: string[]) {
    const response = await rpc(ada, "tools/list", {}, scopes);
    return (response.result?.tools ?? []) as {
      name: string;
      annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean };
      outputSchema?: unknown;
    }[];
  }

  it("lists only the save, search and list tools to a token without the write scope", async () => {
    for (const scopes of [[], ["openid", "profile", "email", "offline_access"]]) {
      const names = (await toolsFor(scopes)).map((tool) => tool.name);
      expect(names.sort()).toEqual(READ_TOOLS);
    }
  });

  it("adds the write tools for a token with the write scope", async () => {
    const tools = await toolsFor(["openid", WRITE_SCOPE]);
    expect(tools.map((tool) => tool.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    const destructive = ["delete_clipping", "merge_tag"];
    for (const tool of tools) {
      expect(tool.annotations?.destructiveHint === true).toBe(destructive.includes(tool.name));
    }
    expect(tools.find((tool) => tool.name === "tag_clippings")?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("describes what every tool returns with an output schema", async () => {
    for (const tool of await toolsFor([WRITE_SCOPE])) {
      expect(tool.outputSchema, tool.name).toMatchObject({ type: "object" });
    }
  });

  it("returns the JSON text and the same value as structured content", async () => {
    await callTool(ada, "save_clipping", { url: "https://example.com/both" });
    const recent = await callTool(ada, "list_recent", {});
    expect(recent.structured).toEqual(recent.json());
    expect((recent.structured as { clippings: unknown[] }).clippings).toHaveLength(1);
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
      ["get_page_text", { id }],
      ["update_clipping", { id, title: "Renamed", note: "changed", tags: ["x"] }],
      ["save_note", { body: "should not be saved" }],
      ["list_tags", {}],
      ["delete_clipping", { id }],
      ["restore_clipping", { id }],
      ["tag_clippings", { ids: [id], add: ["x"] }],
      ["rename_tag", { name: "x", newName: "y" }],
      ["merge_tag", { from: "x", into: "y" }],
      ["set_tag_color", { tag: "x", color: "red" }],
      ["create_folder", { name: "Folder" }],
      ["move_to_folder", { folder: "Folder", clippingIds: [id] }],
      ["link_items", { fromId: id, toId: id, reason: "why" }],
      ["list_folders", {}],
      ["list_suggestions", {}],
      ["apply_suggestion", { id }],
      ["dismiss_suggestion", { id }],
      ["undo_change", { id }],
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
    // Nor was the note saved.
    expect((await fixture.service.listClippings(ada.userId, {})).items).toHaveLength(1);
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

  describe("list_clippings", () => {
    async function saveAs(caller: McpCaller, name: string, tags?: string[]) {
      const saved = await callTool(caller, "save_clipping", { url: `https://example.com/${name}` });
      const { clipping } = saved.json() as { clipping: ToolClipping };
      if (tags) await fixture.service.updateClipping(caller.userId, clipping.id, { tags });
      fixture.advanceClock(60_000);
      return clipping;
    }

    const urlsOf = (result: { json: () => unknown }) =>
      (result.json() as { clippings: ToolClipping[] }).clippings.map((clipping) =>
        clipping.url!.replace("https://example.com/", ""),
      );

    it("lists newest first, pinned among the rest, and pages with nextCursor", async () => {
      const one = await saveAs(ada, "one");
      await saveAs(ada, "two");
      await saveAs(ada, "three");
      await fixture.service.setPinned(ada.userId, one.id, true);

      const first = await callTool(ada, "list_clippings", { limit: 2 });
      expect(urlsOf(first)).toEqual(["three", "two"]);
      const { nextCursor } = first.json() as { nextCursor: string };
      expect(nextCursor).toEqual(expect.any(String));

      const second = await callTool(ada, "list_clippings", { limit: 2, cursor: nextCursor });
      expect(urlsOf(second)).toEqual(["one"]);
      expect(second.json()).toMatchObject({ nextCursor: null });
      expect(second.structured).toEqual(second.json());
    });

    it("filters by tags, by pinned and by the day or moment saved", async () => {
      const a = await saveAs(ada, "a", ["x"]);
      const b = await saveAs(ada, "b", ["x", "y"]);
      const c = await saveAs(ada, "c", ["y"]);
      await fixture.service.setPinned(ada.userId, b.id, true);

      expect(urlsOf(await callTool(ada, "list_clippings", { tags: ["X"] }))).toEqual(["b", "a"]);
      expect(urlsOf(await callTool(ada, "list_clippings", { pinned: true }))).toEqual(["b"]);
      expect(urlsOf(await callTool(ada, "list_clippings", { pinned: false }))).toEqual(["c", "a"]);
      expect(urlsOf(await callTool(ada, "list_clippings", { since: b.savedAt }))).toEqual([
        "c",
        "b",
      ]);
      expect(urlsOf(await callTool(ada, "list_clippings", { until: b.savedAt }))).toEqual([
        "b",
        "a",
      ]);
      expect(
        urlsOf(await callTool(ada, "list_clippings", { since: b.savedAt, until: c.savedAt })),
      ).toEqual(["c", "b"]);

      // A date alone is the whole UTC day, at both ends.
      const day = a.savedAt.slice(0, 10);
      expect(urlsOf(await callTool(ada, "list_clippings", { since: day, until: day }))).toEqual([
        "c",
        "b",
        "a",
      ]);
      expect(urlsOf(await callTool(ada, "list_clippings", { since: "9999-01-01" }))).toEqual([]);
    });

    it("answers a bad date or cursor with a tool error", async () => {
      await saveAs(ada, "a");
      for (const args of [
        { since: "last week" },
        { until: "2026-13-45" },
        { since: "2026-03" },
        { until: "2026-03" },
        { until: "2026" },
        { cursor: "garbage" },
      ]) {
        expect((await callTool(ada, "list_clippings", args)).isError).toBe(true);
      }
    });

    it("keeps users apart", async () => {
      await saveAs(ada, "ada-page", ["secret"]);
      await saveAs(bob, "bob-page", ["secret"]);

      expect(urlsOf(await callTool(bob, "list_clippings", {}))).toEqual(["bob-page"]);
      expect(urlsOf(await callTool(bob, "list_clippings", { tags: ["secret"] }))).toEqual([
        "bob-page",
      ]);
    });
  });

  describe("related_clippings", () => {
    beforeEach(() => {
      for (const word of ["car", "automobile", "sedan", "engine"]) {
        fixture.meanings.set(word, "car");
      }
      fixture.meanings.set("bread", "bread");
    });

    async function clip(caller: McpCaller, name: string, title: string) {
      const url = `https://example.com/${name}`;
      fixture.web.set(url, {
        page: { title, text: "" },
        summary: { title, summary: "", excerpt: "" },
      });
      const saved = await callTool(caller, "save_clipping", { url });
      const { clipping } = saved.json() as { clipping: ToolClipping };
      await fixture.service.enrichClipping(clipping.id);
      fixture.advanceClock(60_000);
      return clipping;
    }

    it("lists the clippings nearest in meaning, within the limit", async () => {
      const sedan = await clip(ada, "sedan", "Sedan");
      await clip(ada, "bread", "Bread");
      await clip(ada, "engine", "Engine");
      await clip(ada, "automobile", "Automobile");

      const related = await callTool(ada, "related_clippings", { id: sedan.id });
      const titles = (related.json() as { clippings: ToolClipping[] }).clippings.map(
        (clipping) => clipping.title,
      );
      expect(titles.toSorted()).toEqual(["Automobile", "Engine"]);
      expect(related.structured).toEqual(related.json());

      const limited = await callTool(ada, "related_clippings", { id: sedan.id, limit: 1 });
      expect((limited.json() as { clippings: unknown[] }).clippings).toHaveLength(1);
    });

    it("keeps users apart and says an unknown id isn't found", async () => {
      const sedan = await clip(ada, "sedan", "Sedan");
      await clip(bob, "engine", "Engine");

      // Bob has no such clipping; Ada's related list holds nothing of Bob's.
      expect((await callTool(bob, "related_clippings", { id: sedan.id })).isError).toBe(true);
      const adas = await callTool(ada, "related_clippings", { id: sedan.id });
      expect((adas.json() as { clippings: unknown[] }).clippings).toEqual([]);
      for (const id of ["not-an-id", "00000000-0000-4000-8000-000000000000"]) {
        expect((await callTool(ada, "related_clippings", { id })).isError).toBe(true);
      }
    });
  });

  describe("with the write scope", () => {
    async function save(caller: McpCaller, url: string, note?: string) {
      const saved = await callTool(caller, "save_clipping", { url, note });
      return (saved.json() as { clipping: ToolClipping }).clipping;
    }

    describe("save_note", () => {
      const body = "# Gearbox ideas\n\n- a wider ratio\n- [ ] ask the shop\n\n<b>raw</b>";

      it("saves Markdown text as a note for the caller, source mcp and the client recorded", async () => {
        const saved = await callTool(ada, "save_note", { body, tags: ["cars"] });

        expect(saved.isError).toBe(false);
        const { clipping } = saved.json() as { clipping: ToolClipping };
        expect(clipping).toMatchObject({
          kind: "note",
          url: null,
          title: "Gearbox ideas",
          // Exactly as sent: no conversion.
          body,
          tags: ["cars"],
          source: "mcp",
          status: "pending",
        });
        expect(clipping.link).toBe(`https://clippings.test/c/${clipping.id}`);
        const stored = await fixture.service.getClipping(ada.userId, clipping.id);
        expect(stored).toMatchObject({ kind: "note", body, clientId: ada.clientId });
        expect(fixture.enrichmentRequests).toEqual([clipping.id]);
      });

      it("keeps users apart: the note is the caller's alone", async () => {
        const { clipping } = (await callTool(ada, "save_note", { body })).json() as {
          clipping: ToolClipping;
        };

        expect((await callTool(bob, "get_clipping", { id: clipping.id })).isError).toBe(true);
        expect((await callTool(bob, "list_recent", {})).json()).toEqual({ clippings: [] });
        expect((await callTool(bob, "delete_clipping", { id: clipping.id })).isError).toBe(true);
        expect(await fixture.service.getClipping(ada.userId, clipping.id)).not.toBeNull();
      });

      it("lists the note next to links, with a null address, and reads it back in full", async () => {
        await save(ada, "https://example.com/a");
        fixture.advanceClock(60_000);
        const { clipping } = (await callTool(ada, "save_note", { body })).json() as {
          clipping: ToolClipping;
        };

        const recent = (await callTool(ada, "list_recent", {})).json() as {
          clippings: ToolClipping[];
        };
        expect(recent.clippings.map((c) => [c.kind, c.url === null])).toEqual([
          ["note", true],
          ["link", false],
        ]);
        // The list leaves the text out; get_clipping has it.
        expect(recent.clippings[0]?.body).toBeUndefined();
        const full = (await callTool(ada, "get_clipping", { id: clipping.id })).json() as {
          clipping: ToolClipping;
        };
        expect(full.clipping.body).toBe(body);
        expect((await callTool(ada, "get_page_text", { id: clipping.id })).isError).toBe(true);
      });

      it("refuses a blank or too long text and saves nothing", async () => {
        expect((await callTool(ada, "save_note", { body: "   \n" })).isError).toBe(true);
        const tooLong = await rpc(ada, "tools/call", {
          name: "save_note",
          arguments: { body: "x".repeat(MAX_NOTE_BODY_LENGTH + 1) },
        });
        expect(tooLong.error ?? tooLong.result?.isError).toBeTruthy();
        expect((await fixture.service.listClippings(ada.userId, {})).items).toEqual([]);
      });
    });

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

    it("returns the research brief with the clipping, only to its owner", async () => {
      const { id } = await save(ada, "https://example.com/shipping");
      type WithBrief = {
        brief: {
          status: string;
          domain: string;
          body: string | null;
          sources: { url: string; title: string }[];
          updatedAt: string;
        } | null;
      };
      const briefOf = async (caller: McpCaller) =>
        ((await callTool(caller, "get_clipping", { id })).json() as WithBrief).brief;

      expect(await briefOf(ada)).toBeNull();

      const started = await fixture.research.requestBriefNow(ada.userId, id);
      if (started.status !== "started") throw new Error(`Not started: ${started.status}`);
      expect(await briefOf(ada)).toMatchObject({ status: "writing", body: null, sources: [] });

      fixture.advanceClock(60_000);
      await fixture.research.completeBrief(started.brief.id, {
        body: "Port congestion is easing.",
        sources: [{ url: "https://example.com/source", title: "A source" }],
      });
      expect(await briefOf(ada)).toEqual({
        status: "ready",
        domain: "",
        body: "Port congestion is easing.",
        sources: [{ url: "https://example.com/source", title: "A source" }],
        updatedAt: "2026-10-01T09:01:00.000Z",
      });
      // Bob has no clipping with that id, so he gets no brief either.
      expect((await callTool(bob, "get_clipping", { id })).isError).toBe(true);
    });

    it("returns the page text Clippings saved, and says so when there is none", async () => {
      fixture.web.set("https://example.com/essay", {
        page: { title: "Essay | Example", text: "A long essay about gardening." },
        summary: {
          title: "An essay about gardening",
          summary: "Why small gardens beat big ones.",
          excerpt: "A long essay about gardening",
        },
      });
      const { id } = await save(ada, "https://example.com/essay");

      // Still pending: nothing was read yet.
      const unread = await callTool(ada, "get_page_text", { id });
      expect(unread.isError).toBe(true);
      expect(unread.text).toBe("Clippings has no saved text for that clipping.");

      await fixture.service.enrichClipping(id);
      expect((await callTool(ada, "get_page_text", { id })).json()).toEqual({
        id,
        url: "https://example.com/essay",
        title: "An essay about gardening",
        text: "A long essay about gardening.",
        fetchedAt: "2026-10-01T09:00:00.000Z",
      });
    });

    it("keeps users apart for page text, and hides it once the clipping is deleted", async () => {
      fixture.web.set("https://example.com/ada-only", {
        page: { title: "Private", text: "Ada's private page text." },
        summary: { title: "Private", summary: "s", excerpt: "e" },
      });
      const { id } = await save(ada, "https://example.com/ada-only");
      await fixture.service.enrichClipping(id);

      const refused = await callTool(bob, "get_page_text", { id });
      expect(refused.isError).toBe(true);
      expect(refused.text).toBe("The user has no clipping with that id.");
      expect(refused.text).not.toContain("private");

      await callTool(ada, "delete_clipping", { id });
      expect((await callTool(ada, "get_page_text", { id })).isError).toBe(true);
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

    it("changes a note's text, and refuses text for a saved page or a blank or too long one", async () => {
      const made = (
        await callTool(ada, "save_note", { body: "# Gearbox\n\nfirst draft" })
      ).json() as { clipping: ToolClipping };
      const id = made.clipping.id;

      const updated = (
        await callTool(ada, "update_clipping", { id, body: "# Gearbox v2\n\n- wider ratio" })
      ).json() as { clipping: ToolClipping };
      expect(updated.clipping).toMatchObject({
        title: "Gearbox v2",
        body: "# Gearbox v2\n\n- wider ratio",
      });

      const link = await save(ada, "https://example.com/page");
      const refused = await callTool(ada, "update_clipping", { id: link.id, body: "text" });
      expect(refused).toMatchObject({ isError: true, text: expect.stringContaining("note") });
      for (const body of ["   ", "x".repeat(MAX_NOTE_BODY_LENGTH + 1)]) {
        expect((await callTool(ada, "update_clipping", { id, body })).isError).toBe(true);
      }
      expect(await fixture.service.getClipping(ada.userId, id)).toMatchObject({
        body: "# Gearbox v2\n\n- wider ratio",
      });
      // Not another user's note.
      expect((await callTool(bob, "update_clipping", { id, body: "mine now" })).isError).toBe(true);
      expect(await fixture.service.getClipping(ada.userId, id)).toMatchObject({
        body: "# Gearbox v2\n\n- wider ratio",
      });
    });

    it("pins and unpins, alone or with other changes, and only the caller's clippings", async () => {
      const { id } = await save(ada, "https://example.com/pin");

      const pinned = (await callTool(ada, "update_clipping", { id, pinned: true })).json() as {
        clipping: ToolClipping;
      };
      expect(pinned.clipping.pinned).toBe(true);
      const both = (
        await callTool(ada, "update_clipping", { id, pinned: false, note: "kept" })
      ).json() as { clipping: ToolClipping };
      expect(both.clipping).toMatchObject({ pinned: false, note: "kept" });

      expect((await callTool(bob, "update_clipping", { id, pinned: true })).isError).toBe(true);
      expect((await fixture.service.getClipping(ada.userId, id))?.pinned).toBe(false);
      // A change that fails leaves the pin alone.
      const failed = await callTool(ada, "update_clipping", { id, pinned: true, body: "text" });
      expect(failed.isError).toBe(true);
      expect((await fixture.service.getClipping(ada.userId, id))?.pinned).toBe(false);
    });

    describe("tag suggestions", () => {
      /** Saves a page that Clippings reads and suggests `names` for. */
      async function suggested(caller: McpCaller, path: string, names: string[], tags?: string[]) {
        await fixture.settings.setSuggestTags(caller.userId, true);
        const url = `https://example.com/${path}`;
        fixture.web.set(url, {
          page: { title: path, text: "" },
          summary: { title: path, summary: "", excerpt: "", suggestedTags: names },
        });
        const { id } = await save(caller, url);
        if (tags) await callTool(caller, "update_clipping", { id, tags });
        await fixture.service.enrichClipping(id);
        fixture.advanceClock(1000);
        return id;
      }

      type Result = { clipping: ToolClipping };
      const read = async (caller: McpCaller, id: string) =>
        ((await callTool(caller, "get_clipping", { id })).json() as Result).clipping;

      it("shows the suggestions a clipping waits on in get_clipping, empty when none", async () => {
        const id = await suggested(ada, "a", ["layout", "css"], ["web"]);
        const plain = await save(ada, "https://example.com/plain");

        expect((await read(ada, id)).suggestedTags).toEqual(["css", "layout"]);
        expect((await read(ada, plain.id)).suggestedTags).toEqual([]);
      });

      it("accepts the named suggestions or all of them, and returns the clipping", async () => {
        const id = await suggested(ada, "a", ["css", "layout", "grid"], ["web"]);

        const some = (
          await callTool(ada, "accept_tag_suggestions", { id, names: ["Layout", "nope"] })
        ).json() as Result;
        expect(some.clipping).toMatchObject({
          tags: ["layout", "web"],
          suggestedTags: ["css", "grid"],
        });

        const all = (await callTool(ada, "accept_tag_suggestions", { id })).json() as Result;
        expect(all.clipping).toMatchObject({
          tags: ["css", "grid", "layout", "web"],
          suggestedTags: [],
        });
      });

      it("dismisses the named suggestions or all of them, for good", async () => {
        const id = await suggested(ada, "a", ["css", "layout", "grid"]);

        const some = (
          await callTool(ada, "dismiss_tag_suggestions", { id, names: ["css"] })
        ).json() as Result;
        expect(some.clipping).toMatchObject({ tags: [], suggestedTags: ["grid", "layout"] });
        const all = (await callTool(ada, "dismiss_tag_suggestions", { id })).json() as Result;
        expect(all.clipping.suggestedTags).toEqual([]);
        expect((await callTool(ada, "accept_tag_suggestions", { id })).json()).toMatchObject({
          clipping: { tags: [] },
        });
      });

      it("fails, changing nothing, when accepting would pass the tag limit", async () => {
        const full = Array.from({ length: MAX_TAGS_PER_CLIPPING - 1 }, (_, i) => `tag ${i}`);
        const id = await suggested(ada, "a", ["css", "layout"], full);

        const refused = await callTool(ada, "accept_tag_suggestions", { id });

        expect(refused.isError).toBe(true);
        expect((await read(ada, id)).suggestedTags).toEqual(["css", "layout"]);
        expect((await read(ada, id)).tags).toHaveLength(MAX_TAGS_PER_CLIPPING - 1);
      });

      it("lists the clippings with suggestions a page at a time, with their tags and names", async () => {
        const first = await suggested(ada, "a", ["css"], ["web"]);
        const second = await suggested(ada, "b", ["layout", "css"]);
        const settled = await suggested(ada, "c", ["grid"]);
        await callTool(ada, "dismiss_tag_suggestions", { id: settled });
        await save(ada, "https://example.com/plain");
        type Page = {
          clippings: ToolClipping[];
          nextCursor: string | null;
        };

        const page = (await callTool(ada, "list_tag_suggestions", { limit: 1 })).json() as Page;
        const next = (
          await callTool(ada, "list_tag_suggestions", { limit: 1, cursor: page.nextCursor })
        ).json() as Page;

        expect(page.clippings).toMatchObject([
          { id: second, kind: "link", suggestedTags: ["css", "layout"], tags: [] },
        ]);
        expect(next.clippings).toMatchObject([
          {
            id: first,
            url: "https://example.com/a",
            tags: ["web"],
            suggestedTags: ["css"],
          },
        ]);
        expect(next.nextCursor).toBeNull();
        expect((await callTool(ada, "list_tag_suggestions", { cursor: "nope" })).isError).toBe(
          true,
        );
      });

      it("keeps users apart", async () => {
        const id = await suggested(ada, "a", ["css"]);
        await suggested(bob, "b", ["rust"]);

        const mine = (await callTool(bob, "list_tag_suggestions", {})).json() as {
          clippings: ToolClipping[];
        };
        expect(mine.clippings.map((clipping) => clipping.suggestedTags)).toEqual([["rust"]]);
        for (const tool of ["accept_tag_suggestions", "dismiss_tag_suggestions"]) {
          expect((await callTool(bob, tool, { id })).isError).toBe(true);
        }
        expect((await read(ada, id)).suggestedTags).toEqual(["css"]);
        expect((await read(ada, id)).tags).toEqual([]);
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

    describe("tag tools", () => {
      const tagNames = async (caller: McpCaller, id: string) =>
        (await fixture.service.getClipping(caller.userId, id))?.tags
          .map((tag) => tag.name)
          .toSorted();

      it("renames a tag by name, ignoring case, on every clipping that carries it", async () => {
        const a = await save(ada, "https://example.com/a");
        const b = await save(ada, "https://example.com/b");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["Work", "keep"] });
        await callTool(ada, "update_clipping", { id: b.id, tags: ["work"] });

        const renamed = await callTool(ada, "rename_tag", { name: "WORK", newName: "Projects" });
        expect(renamed.json()).toEqual({
          from: "Work",
          to: "Projects",
          changeId: expect.any(String),
        });
        expect(renamed.structured).toEqual(renamed.json());
        expect(await tagNames(ada, a.id)).toEqual(["Projects", "keep"]);
        expect(await tagNames(ada, b.id)).toEqual(["Projects"]);
      });

      it("fails to rename an unknown tag, to a name another tag has, or to an invalid name", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["one", "two"] });

        expect((await callTool(ada, "rename_tag", { name: "nope", newName: "x" })).isError).toBe(
          true,
        );
        expect((await callTool(ada, "rename_tag", { name: "one", newName: "TWO" })).isError).toBe(
          true,
        );
        expect((await callTool(ada, "rename_tag", { name: "one", newName: "   " })).isError).toBe(
          true,
        );
        expect(await tagNames(ada, a.id)).toEqual(["one", "two"]);
      });

      it("merges a tag into another and removes it", async () => {
        const a = await save(ada, "https://example.com/a");
        const b = await save(ada, "https://example.com/b");
        const c = await save(ada, "https://example.com/c");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["js", "web"] });
        await callTool(ada, "update_clipping", { id: b.id, tags: ["javascript", "js"] });
        await callTool(ada, "update_clipping", { id: c.id, tags: ["web"] });

        const merged = await callTool(ada, "merge_tag", { from: "JS", into: "javascript" });
        expect(merged.json()).toEqual({
          merged: true,
          from: "js",
          into: "javascript",
          changeId: expect.any(String),
        });
        expect(await tagNames(ada, a.id)).toEqual(["javascript", "web"]);
        expect(await tagNames(ada, b.id)).toEqual(["javascript"]);
        expect(await tagNames(ada, c.id)).toEqual(["web"]);
        const { tags } = (await callTool(ada, "list_tags", {})).json() as {
          tags: { name: string }[];
        };
        expect(tags.map((tag) => tag.name)).toEqual(["javascript", "web"]);
      });

      it("fails to merge an unknown tag or a tag into itself", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["one", "two"] });

        for (const args of [
          { from: "nope", into: "one" },
          { from: "one", into: "nope" },
          { from: "one", into: "ONE" },
        ]) {
          expect((await callTool(ada, "merge_tag", args)).isError).toBe(true);
        }
        expect(await tagNames(ada, a.id)).toEqual(["one", "two"]);
      });

      it("keeps users apart when renaming and merging tags", async () => {
        const mine = await save(ada, "https://example.com/mine");
        const theirs = await save(bob, "https://example.com/theirs");
        await callTool(ada, "update_clipping", { id: mine.id, tags: ["shared name"] });
        await callTool(bob, "update_clipping", { id: theirs.id, tags: ["bobs", "other"] });

        // Ada has no tag "bobs": nothing of Bob's is found, renamed or merged.
        expect((await callTool(ada, "rename_tag", { name: "bobs", newName: "x" })).isError).toBe(
          true,
        );
        expect(
          (await callTool(ada, "merge_tag", { from: "bobs", into: "shared name" })).isError,
        ).toBe(true);
        expect(
          (await callTool(ada, "merge_tag", { from: "shared name", into: "bobs" })).isError,
        ).toBe(true);
        expect(await tagNames(bob, theirs.id)).toEqual(["bobs", "other"]);

        // A name Bob has doesn't clash with Ada's rename.
        const renamed = await callTool(ada, "rename_tag", {
          name: "shared name",
          newName: "other",
        });
        expect(renamed.isError).toBe(false);
        expect(await tagNames(bob, theirs.id)).toEqual(["bobs", "other"]);
      });

      it("adds and removes tags on several clippings, keeping each one's other tags", async () => {
        const a = await save(ada, "https://example.com/a");
        const b = await save(ada, "https://example.com/b");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["keep", "old"] });
        await callTool(ada, "update_clipping", { id: b.id, tags: ["old"] });

        const tagged = await callTool(ada, "tag_clippings", {
          ids: [a.id, b.id],
          add: ["new"],
          remove: ["OLD"],
        });
        expect(tagged.json()).toEqual({ changed: 2, notFound: [] });
        expect(tagged.structured).toEqual({ changed: 2, notFound: [] });
        expect(await tagNames(ada, a.id)).toEqual(["keep", "new"]);
        expect(await tagNames(ada, b.id)).toEqual(["new"]);

        // Idempotent: the same call again changes nothing.
        const again = await callTool(ada, "tag_clippings", {
          ids: [a.id, b.id],
          add: ["new"],
          remove: ["old"],
        });
        expect(again.json()).toEqual({ changed: 0, notFound: [] });
      });

      it("reports ids that aren't the user's and never touches another user's clipping", async () => {
        const mine = await save(ada, "https://example.com/mine");
        const theirs = await save(bob, "https://example.com/theirs");
        await callTool(bob, "update_clipping", { id: theirs.id, tags: ["private"] });
        const missing = "00000000-0000-4000-8000-000000000000";

        const outcome = await callTool(ada, "tag_clippings", {
          ids: [mine.id, theirs.id, missing],
          add: ["x"],
          remove: ["private"],
        });
        expect(outcome.json()).toEqual({ changed: 1, notFound: [theirs.id, missing] });
        expect(await tagNames(bob, theirs.id)).toEqual(["private"]);
      });

      it("refuses a call that names no tag or a tag both added and removed, and one past the limits", async () => {
        const a = await save(ada, "https://example.com/a");
        const ids = [a.id];

        expect((await callTool(ada, "tag_clippings", { ids })).isError).toBe(true);
        expect((await callTool(ada, "tag_clippings", { ids, add: [], remove: [] })).isError).toBe(
          true,
        );
        expect(
          (await callTool(ada, "tag_clippings", { ids, add: ["x"], remove: ["X"] })).isError,
        ).toBe(true);
        // Past the limits, the input schema refuses the call.
        for (const args of [
          { ids: [], add: ["x"] },
          { ids: Array.from({ length: 101 }, (_, index) => `id-${index}`), add: ["x"] },
          { ids, add: ["x".repeat(MAX_TAG_LENGTH + 1)] },
        ]) {
          const response = await rpc(ada, "tools/call", { name: "tag_clippings", arguments: args });
          expect(response.error ?? response.result?.isError).toBeTruthy();
        }
        expect(await tagNames(ada, a.id)).toEqual([]);
      });

      it("refuses when a clipping would carry too many tags, and tags none of them", async () => {
        const full = await save(ada, "https://example.com/full");
        const roomy = await save(ada, "https://example.com/roomy");
        await callTool(ada, "update_clipping", {
          id: full.id,
          tags: Array.from({ length: MAX_TAGS_PER_CLIPPING }, (_, index) => `tag ${index}`),
        });

        const refused = await callTool(ada, "tag_clippings", {
          ids: [roomy.id, full.id],
          add: ["one more"],
        });
        expect(refused.isError).toBe(true);
        expect(await tagNames(ada, roomy.id)).toEqual([]);
      });
    });

    describe("librarian tools", () => {
      interface ToolChange {
        id: string | null;
        action: string;
        status: string;
        actor: string;
        summary: string;
        targetIds: string[];
        before: unknown;
        after: unknown;
      }
      interface Outcome {
        outcome: "applied" | "would_apply" | "skipped";
        change: ToolChange | null;
        reason: string | null;
      }

      const tagRow = async (userId: string, name: string) => {
        const tag = await fixture.service.findTagByName(userId, name);
        const { rows } = await fixture.pool.query(
          `select color, color_overridden, folder_id from tags where id = $1`,
          [tag?.id],
        );
        return rows[0] as { color: string; color_overridden: boolean; folder_id: string | null };
      };
      const tagNames = async (caller: McpCaller, id: string) =>
        (await fixture.service.getClipping(caller.userId, id))?.tags
          .map((tag) => tag.name)
          .toSorted();
      const logged = async (userId: string) =>
        (
          await fixture.pool.query(
            `select actor, action, status from library_changes where user_id = $1 order by created_at, id`,
            [userId],
          )
        ).rows;

      it("sets a tag color, logs it as the user's, and the librarian can't change it afterwards", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["css"] });

        const set = await callTool(ada, "set_tag_color", { tag: "CSS", color: "violet" });

        const outcome = set.json() as Outcome;
        expect(set.structured).toEqual(outcome);
        expect(outcome).toMatchObject({
          outcome: "applied",
          change: { action: "set_tag_color", status: "applied", actor: "user_via_mcp" },
        });
        expect(await tagRow(ada.userId, "css")).toEqual({
          color: "violet",
          color_overridden: true,
          folder_id: null,
        });
        const tag = await fixture.service.findTagByName(ada.userId, "css");
        const byLibrarian = await fixture.librarian.proposeChange(ada.userId, "librarian", {
          action: "set_tag_color",
          tagId: tag!.id,
          color: "red",
          confidence: "high",
          reason: "Looks red",
        });
        expect(byLibrarian.outcome).toBe("skipped");
        expect((await tagRow(ada.userId, "css")).color).toBe("violet");
      });

      it("reports a dry run and changes nothing", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["css"] });

        const set = await callTool(ada, "set_tag_color", {
          tag: "css",
          color: "red",
          dryRun: true,
        });
        const folder = await callTool(ada, "create_folder", { name: "Web", dryRun: true });

        expect(set.json()).toMatchObject({
          outcome: "would_apply",
          change: { id: null, summary: 'Color the tag "css" red' },
        });
        expect((folder.json() as Outcome).outcome).toBe("would_apply");
        expect((await tagRow(ada.userId, "css")).color).toBe("none");
        expect(await logged(ada.userId)).toEqual([]);
        expect(
          ((await callTool(ada, "list_folders", {})).json() as { folders: [] }).folders,
        ).toEqual([]);
      });

      it("fails on an unknown tag, a color outside the palette and a tag that is another user's", async () => {
        const b = await save(bob, "https://example.com/b");
        await callTool(bob, "update_clipping", { id: b.id, tags: ["bobs"] });

        expect((await callTool(ada, "set_tag_color", { tag: "bobs", color: "red" })).isError).toBe(
          true,
        );
        const response = await rpc(ada, "tools/call", {
          name: "set_tag_color",
          arguments: { tag: "x", color: "#ff0000" },
        });
        expect(response.error ?? response.result?.isError).toBeTruthy();
        expect((await tagRow(bob.userId, "bobs")).color).toBe("none");
      });

      it("creates folders, lists them, and files clippings and tags in one, the tag taking its color", async () => {
        const a = await save(ada, "https://example.com/a");
        const n = (await callTool(ada, "save_note", { body: "A thought" })).json() as {
          clipping: ToolClipping;
        };
        await callTool(ada, "update_clipping", { id: a.id, tags: ["css"] });

        const created = await callTool(ada, "create_folder", { name: "Web dev", color: "teal" });
        const again = await callTool(ada, "create_folder", { name: "WEB DEV" });
        const moved = await callTool(ada, "move_to_folder", {
          folder: "web DEV",
          clippingIds: [a.id, n.clipping.id, "00000000-0000-4000-8000-000000000000"],
          tags: ["css", "nope"],
        });

        expect((created.json() as Outcome).outcome).toBe("applied");
        expect(again.json()).toMatchObject({ outcome: "skipped" });
        const { results } = moved.json() as {
          results: {
            item: string;
            outcome: string;
            changeId: string | null;
            reason: string | null;
          }[];
        };
        expect(results.map((r) => [r.item, r.outcome])).toEqual([
          [a.id, "applied"],
          [n.clipping.id, "applied"],
          ["00000000-0000-4000-8000-000000000000", "skipped"],
          ["css", "applied"],
          ["nope", "skipped"],
        ]);
        expect((await callTool(ada, "list_folders", {})).json()).toEqual({
          folders: [{ name: "Web dev", color: "teal", clippings: 2, tags: 1 }],
        });
        expect((await tagRow(ada.userId, "css")).color).toBe("teal");
      });

      it("won't move into an unknown or another user's folder, or move nothing", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(bob, "create_folder", { name: "Bobs" });

        expect(
          (await callTool(ada, "move_to_folder", { folder: "Bobs", clippingIds: [a.id] })).isError,
        ).toBe(true);
        await callTool(ada, "create_folder", { name: "Mine" });
        expect((await callTool(ada, "move_to_folder", { folder: "Mine" })).isError).toBe(true);
        expect((await callTool(ada, "list_folders", {})).json()).toEqual({
          folders: [{ name: "Mine", color: "none", clippings: 0, tags: 0 }],
        });
      });

      it("links two items with a reason, once per pair, and refuses another user's item", async () => {
        const a = await save(ada, "https://example.com/a");
        const b = await save(ada, "https://example.com/b");
        const theirs = await save(bob, "https://example.com/theirs");

        const linked = await callTool(ada, "link_items", {
          fromId: a.id,
          toId: b.id,
          reason: "Both about layout",
        });
        const reversed = await callTool(ada, "link_items", {
          fromId: b.id,
          toId: a.id,
          reason: "Same",
        });

        expect(linked.json()).toMatchObject({
          outcome: "applied",
          change: { action: "link_items" },
        });
        expect(reversed.json()).toMatchObject({ outcome: "skipped" });
        for (const args of [
          { fromId: a.id, toId: theirs.id, reason: "x" },
          { fromId: a.id, toId: a.id, reason: "x" },
          { fromId: a.id, toId: b.id, reason: "   " },
        ]) {
          expect((await callTool(ada, "link_items", args)).isError).toBe(true);
        }
        const { rows } = await fixture.pool.query(`select reason from item_links`);
        expect(rows).toEqual([{ reason: "Both about layout" }]);
      });

      it("merges a tag, logs it, and undo_change brings the tag back on its clippings", async () => {
        const a = await save(ada, "https://example.com/a");
        const b = await save(ada, "https://example.com/b");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["js", "web"] });
        await callTool(ada, "update_clipping", { id: b.id, tags: ["js"] });
        await callTool(ada, "set_tag_color", { tag: "js", color: "amber" });

        const merged = (await callTool(ada, "merge_tag", { from: "js", into: "web" })).json() as {
          changeId: string;
        };
        expect(await tagNames(ada, b.id)).toEqual(["web"]);
        const undone = await callTool(ada, "undo_change", { id: merged.changeId });

        expect(undone.json()).toMatchObject({ change: { id: merged.changeId, status: "undone" } });
        expect(await tagNames(ada, a.id)).toEqual(["js", "web"]);
        expect(await tagNames(ada, b.id)).toEqual(["js"]);
        expect((await tagRow(ada.userId, "js")).color).toBe("amber");
      });

      it("undoes a rename, and refuses to undo a change a later one touched", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["css"] });
        const colored = (
          await callTool(ada, "set_tag_color", { tag: "css", color: "red" })
        ).json() as Outcome;
        const renamed = (
          await callTool(ada, "rename_tag", { name: "css", newName: "styles" })
        ).json() as { changeId: string };

        const refused = await callTool(ada, "undo_change", { id: colored.change!.id! });
        expect(refused.isError).toBe(true);
        expect((await tagRow(ada.userId, "styles")).color).toBe("red");

        await callTool(ada, "undo_change", { id: renamed.changeId });
        await callTool(ada, "undo_change", { id: colored.change!.id! });
        expect(await tagNames(ada, a.id)).toEqual(["css"]);
        expect((await tagRow(ada.userId, "css")).color).toBe("none");
        expect((await callTool(ada, "undo_change", { id: renamed.changeId })).isError).toBe(true);
      });

      it("lists the librarian's suggestions, applies one, dismisses another, and keeps users apart", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["css", "style"] });
        const css = (await fixture.service.findTagByName(ada.userId, "css"))!;
        const style = (await fixture.service.findTagByName(ada.userId, "style"))!;
        for (const [color, tagId] of [
          ["blue", css.id],
          ["pink", style.id],
        ] as const) {
          fixture.advanceClock(1000);
          await fixture.librarian.proposeChange(ada.userId, "librarian", {
            action: "set_tag_color",
            tagId,
            color,
            confidence: "low",
            reason: "Looks right",
          });
        }

        const listed = (await callTool(ada, "list_suggestions", { limit: 1 })).json() as {
          suggestions: ToolChange[];
          nextCursor: string;
        };
        const next = (
          await callTool(ada, "list_suggestions", { cursor: listed.nextCursor })
        ).json() as { suggestions: ToolChange[]; nextCursor: null };

        expect(listed.suggestions[0]).toMatchObject({
          status: "suggested",
          actor: "librarian",
          summary: 'Color the tag "style" pink',
        });
        expect(next.suggestions.map((change) => change.summary)).toEqual([
          'Color the tag "css" blue',
        ]);
        // Bob sees none of it and can't decide on Ada's.
        const id = listed.suggestions[0]!.id!;
        expect((await callTool(bob, "list_suggestions", {})).json()).toEqual({
          suggestions: [],
          nextCursor: null,
        });
        expect((await callTool(bob, "apply_suggestion", { id })).isError).toBe(true);
        expect((await callTool(bob, "dismiss_suggestion", { id })).isError).toBe(true);

        const applied = await callTool(ada, "apply_suggestion", { id });
        expect(applied.json()).toMatchObject({ change: { id, status: "applied" } });
        expect((await tagRow(ada.userId, "style")).color).toBe("pink");
        expect((await callTool(ada, "apply_suggestion", { id })).isError).toBe(true);
        const dismissed = await callTool(ada, "dismiss_suggestion", {
          id: next.suggestions[0]!.id,
        });
        expect(dismissed.json()).toMatchObject({ change: { status: "dismissed" } });
        expect((await tagRow(ada.userId, "css")).color).toBe("none");
        expect((await callTool(ada, "list_suggestions", {})).json()).toEqual({
          suggestions: [],
          nextCursor: null,
        });
        expect((await callTool(ada, "list_suggestions", { cursor: "nope" })).isError).toBe(true);
      });

      it("refuses a stale suggestion and leaves it listed", async () => {
        const a = await save(ada, "https://example.com/a");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["css"] });
        const css = (await fixture.service.findTagByName(ada.userId, "css"))!;
        await fixture.librarian.proposeChange(ada.userId, "librarian", {
          action: "set_tag_color",
          tagId: css.id,
          color: "blue",
          confidence: "low",
          reason: "Looks right",
        });
        const [{ id }] = (
          (await callTool(ada, "list_suggestions", {})).json() as { suggestions: ToolChange[] }
        ).suggestions as [ToolChange];
        await callTool(ada, "set_tag_color", { tag: "css", color: "red" });

        const applied = await callTool(ada, "apply_suggestion", { id: id! });

        expect(applied.isError).toBe(true);
        expect(applied.text).toContain("no longer applies");
        expect((await tagRow(ada.userId, "css")).color).toBe("red");
      });

      it("never deletes a clipping or note, whatever the tool", async () => {
        const a = await save(ada, "https://example.com/a");
        const b = await save(ada, "https://example.com/b");
        await callTool(ada, "update_clipping", { id: a.id, tags: ["one"] });
        await callTool(ada, "update_clipping", { id: b.id, tags: ["two"] });
        await callTool(ada, "create_folder", { name: "F" });
        await callTool(ada, "move_to_folder", { folder: "F", clippingIds: [a.id], tags: ["one"] });
        await callTool(ada, "link_items", { fromId: a.id, toId: b.id, reason: "Related" });
        const merged = (await callTool(ada, "merge_tag", { from: "one", into: "two" })).json() as {
          changeId: string;
        };
        await callTool(ada, "undo_change", { id: merged.changeId });

        const { rows } = await fixture.pool.query(
          `select count(*)::int as live from clippings where deleted_at is null`,
        );
        expect(rows[0].live).toBe(2);
        expect(await logged(ada.userId)).toHaveLength(5);
      });

      describe("run_librarian", () => {
        interface RunChange {
          outcome: string;
          action: string;
          change: {
            action: string;
            targetIds: string[];
            reason: string;
            confidence: string;
          } | null;
          reason: string | null;
        }
        interface Run {
          dryRun: boolean;
          firstRun: boolean;
          counts: Record<string, number>;
          changes: RunChange[];
        }

        /** Two pages about css: merge "css layout" into "css", file the first under a new folder. */
        async function seedLibrary(caller: McpCaller) {
          const a = await save(caller, "https://example.com/a");
          const b = await save(caller, "https://example.com/b");
          await callTool(caller, "update_clipping", { id: a.id, tags: ["css", "css layout"] });
          await callTool(caller, "update_clipping", { id: b.id, tags: ["css"] });
          planFor = (index) => {
            const tag = (name: string) =>
              index.tagRef(index.view.tags.find((candidate) => candidate.name === name)!.id)!;
            return {
              ...EMPTY_PLAN,
              merges: [
                {
                  source: tag("css layout"),
                  target: tag("css"),
                  reason: "The same topic",
                  confidence: "high",
                },
              ],
              folders: [
                { name: "Frontend", color: "blue", reason: "Web styling", confidence: "high" },
              ],
              moves: [{ ref: index.itemRef(a.id)!, folder: "Frontend", confidence: "high" }],
            };
          };
          return { a, b };
        }

        const run = async (caller: McpCaller, args: Record<string, unknown> = {}) =>
          (await callTool(caller, "run_librarian", args)).structured as Run;

        const changeCount = async (userId: string) =>
          (
            await fixture.pool.query(
              `select count(*)::int as n from library_changes where user_id = $1`,
              [userId],
            )
          ).rows[0].n as number;

        /** What identifies a change in a list, whichever path made it. */
        const shape = (changes: RunChange[]) =>
          changes.map(({ action, change }) => ({
            action,
            targetIds: change?.targetIds,
            reason: change?.reason,
            confidence: change?.confidence,
          }));

        it("is a dry run by default: it lists the changes and writes nothing", async () => {
          await seedLibrary(ada);
          const before = await changeCount(ada.userId);

          const result = await run(ada);

          expect(result.dryRun).toBe(true);
          expect(result.changes.map((entry) => entry.action)).toEqual([
            "merge_tag",
            "create_folder",
            "move_to_folder",
          ]);
          expect(await changeCount(ada.userId)).toBe(before);
          expect(await fixture.service.findTagByName(ada.userId, "css layout")).not.toBeNull();
        });

        it("gives the same change list as the weekly job for the same library", async () => {
          await seedLibrary(ada);
          const dry = await run(ada);

          const job = await handleLibrarianJob(
            new Request("https://clippings.test/api/jobs/librarian", {
              method: "POST",
              headers: { "Upstash-Signature": "signed" },
              body: JSON.stringify({ userId: ada.userId }),
            }),
            {
              url: "https://clippings.test/api/jobs/librarian",
              receiver: { verify: async () => true },
              runner,
            },
          );
          const stored = (
            await fixture.pool.query(
              `select action, target_ids, reason, confidence, status from library_changes
               where user_id = $1 order by created_at, id`,
              [ada.userId],
            )
          ).rows as {
            action: string;
            target_ids: string[];
            reason: string;
            confidence: string;
            status: string;
          }[];

          expect(job.status).toBe(200);
          expect(dry.firstRun).toBe(true);
          expect(dry.counts).toMatchObject({ wouldSuggest: 3, wouldApply: 0 });
          expect(stored.map((row) => row.status)).toEqual(["suggested", "suggested", "suggested"]);
          // The log holds them in the order they were made; a frozen clock gives them one time.
          const byAction = <T extends { action: string }>(list: T[]) =>
            list.toSorted((x, y) => x.action.localeCompare(y.action));
          expect(
            byAction(
              stored.map(({ action, target_ids, reason, confidence }) => ({
                action,
                targetIds: target_ids,
                reason,
                confidence,
              })),
            ),
          ).toEqual(byAction(shape(dry.changes)));
        });

        it("applies what the librarian is sure of after the first run, and a merge can be undone", async () => {
          const { a } = await seedLibrary(ada);
          await fixture.librarian.markLibrarianRun(ada.userId);
          const dry = await run(ada);

          const real = await run(ada, { dryRun: false });

          expect(dry.firstRun).toBe(false);
          expect(dry.counts).toMatchObject({ wouldApply: 3 });
          expect(real.counts).toMatchObject({ applied: 3 });
          expect(shape(real.changes)).toEqual(shape(dry.changes));
          expect(await fixture.service.findTagByName(ada.userId, "css layout")).toBeNull();
          expect(await tagNames(ada, a.id)).toEqual(["css"]);

          const merge = real.changes.find((entry) => entry.action === "merge_tag")!;
          const changeId = (merge.change as unknown as { id: string }).id;
          const undone = await callTool(ada, "undo_change", { id: changeId });

          expect(undone.isError).toBe(false);
          expect(await fixture.service.findTagByName(ada.userId, "css layout")).not.toBeNull();
          expect(await tagNames(ada, a.id)).toEqual(["css", "css layout"]);
        });

        it("treats a first run cut off partway as a first run when QStash redelivers it", async () => {
          await seedLibrary(ada);
          const flaky = createLibrarianRunner({
            librarian: {
              ...fixture.librarian,
              proposeChanges: async (userId, actor, proposals, options) => {
                await fixture.librarian.proposeChanges(
                  userId,
                  actor,
                  proposals.slice(0, 1),
                  options,
                );
                throw new Error("cut off");
              },
            },
            planner: {
              plan: async (_userId, index) => ({
                plan: planFor(index),
                capReached: false,
                notices: [],
                costMicros: 0,
              }),
            },
            now: () => fixture.clock.now(),
          });
          const deliver = (jobRunner: typeof runner) =>
            handleLibrarianJob(
              new Request("https://clippings.test/api/jobs/librarian", {
                method: "POST",
                headers: { "Upstash-Signature": "signed" },
                body: JSON.stringify({ userId: ada.userId }),
              }),
              {
                url: "https://clippings.test/api/jobs/librarian",
                receiver: { verify: async () => true },
                runner: jobRunner,
              },
            );
          const statuses = async () =>
            (
              await fixture.pool.query(
                `select distinct status from library_changes where user_id = $1`,
                [ada.userId],
              )
            ).rows.map((row) => row.status);

          expect((await deliver(flaky)).status).toBe(500);
          const redelivered = await deliver(runner);

          expect(redelivered.status).toBe(200);
          expect(await redelivered.json()).toMatchObject({ firstRun: true, applied: 0 });
          expect(await statuses()).toEqual(["suggested"]);
          expect(await fixture.service.findTagByName(ada.userId, "css layout")).not.toBeNull();
          // The finished run is the first one; the next may apply what it is sure of.
          expect((await run(ada)).firstRun).toBe(false);
        });

        it("plans from the caller's library only", async () => {
          await seedLibrary(ada);
          await save(bob, "https://example.com/bobs");

          await run(bob);

          expect(planned).toEqual([bob.userId]);
          expect(await changeCount(ada.userId)).toBe(0);
        });

        it("is offered only with write access", async () => {
          const names = (await toolsFor([])).map((tool) => tool.name);
          expect(names).not.toContain("run_librarian");
        });
      });
    });
  });
});
