import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

import { createClippingsMcpHandler } from "./handler.ts";
import type { McpCaller } from "./tools.ts";

interface ToolClipping {
  id: string;
  url: string;
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
  async function rpc(caller: McpCaller, method: string, params: Record<string, unknown>) {
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
      scopes: [],
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

  async function callTool(caller: McpCaller, name: string, args: Record<string, unknown>) {
    const response = await rpc(caller, "tools/call", { name, arguments: args });
    const result = response.result;
    if (!result) throw new Error(`No result: ${JSON.stringify(response)}`);
    const text = result.content[0]?.text ?? "";
    return { isError: result.isError ?? false, text, json: () => JSON.parse(text) };
  }

  it("lists the three tools", async () => {
    const response = await rpc(ada, "tools/list", {});
    const tools = (response.result?.tools ?? []) as { name: string }[];
    const names = tools.map((tool) => tool.name);
    expect(names.sort()).toEqual(["list_recent", "save_clipping", "search_clippings"]);
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
});
