import type Anthropic from "@anthropic-ai/sdk";
import { parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import type { Gateway } from "@/lib/gateway/gateway.ts";
import type { LibraryView } from "@clippings/db";

import { indexLibrary } from "./library-index.ts";
import { createPlanner, LINK_CHECK_MODEL, PLANNER_MODEL } from "./planner.ts";

const NOW = parseISO("2026-11-30T12:00:00Z");

const view: LibraryView = {
  totalItems: 4,
  items: ["a", "b", "c", "d"].map((name, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    kind: "link" as const,
    title: `Item ${name}`,
    summary: `About ${name}`,
    tags: ["css"],
    folderId: null,
    savedAt: "2026-11-01T00:00:00Z",
  })),
  tags: [
    {
      id: "00000000-0000-4000-8000-000000000100",
      name: "css",
      usage: 4,
      folderId: null,
      color: "none",
      colorOverridden: false,
      createdAt: "2026-10-01T00:00:00Z",
      hasTopicPage: false,
    },
  ],
  folders: [],
};
const index = indexLibrary(view, NOW);

/** The last line of a request's user message. */
const lastLine = (request: Anthropic.MessageCreateParamsNonStreaming) => {
  const content = request.messages[0]?.content;
  return typeof content === "string" ? content.split("\n").at(-1) : undefined;
};

type Reply = object | "cap";

/** A gateway that answers each call with the next reply: tool input, or the cap. */
function gatewayWith(replies: Reply[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const gateway: Pick<Gateway, "message"> = {
    async message({ request }) {
      requests.push(request);
      const reply = replies.shift();
      if (reply === "cap") return { status: "cap_reached", reason: "daily_cap" };
      return {
        status: "ok",
        costMicros: 1_000,
        value: {
          content: [{ type: "tool_use", id: "t", name: "x", input: reply }],
        } as unknown as Anthropic.Message,
      };
    },
  };
  return { gateway, requests };
}

const tags = { merges: [], renames: [], folds: [], too_broad: [] };
const folders = {
  folders: [{ name: "Web", color: "blue", reason: "Web", confidence: "high" }],
  moves: [
    { ref: "T1", folder: "Web", confidence: "high" },
    { ref: "C1", folder: "Web", confidence: "high" },
    // Not in the batch asked for: dropped.
    { ref: "C99", folder: "Web", confidence: "high" },
  ],
};
const links = {
  links: [
    { a: "C1", b: "C2", reason: "Both css", confidence: "high" },
    { a: "C3", b: "C4", reason: "Weak", confidence: "low" },
  ],
};
const pages = { pages: [{ tag: "T1", overview: "O", items: [], confidence: "high" }] };
const verdicts = {
  verdicts: [
    { index: 0, keep: true },
    { index: 1, keep: false },
  ],
};

const planner = (replies: Reply[]) => {
  const { gateway, requests } = gatewayWith(replies);
  return { requests, planner: createPlanner({ gateway, now: () => NOW }) };
};

describe("the librarian planner", () => {
  it("plans in stages, keeps only the links Haiku confirms, and sums the cost", async () => {
    const { planner: p, requests } = planner([tags, folders, links, verdicts, pages]);

    const result = await p.plan("u", index, { budgetMs: 240_000 });

    expect(result.capReached).toBe(false);
    expect(result.costMicros).toBe(5_000);
    expect(result.plan.links).toEqual([
      { a: "C1", b: "C2", reason: "Both css", confidence: "high" },
    ]);
    expect(result.plan.moves.map((move) => move.ref)).toEqual(["T1", "C1"]);
    expect(result.plan.pages).toHaveLength(1);
    // Sonnet 5.5 refuses a forced tool choice with a 400, so no call forces one: each is asked by
    // name, whichever model it goes to.
    const asked = { type: "auto", disable_parallel_tool_use: true };
    expect(requests.map((r) => [r.model, r.tool_choice, lastLine(r)])).toEqual([
      [PLANNER_MODEL, asked, "Answer by calling plan_tags, once, and write nothing else."],
      [PLANNER_MODEL, asked, "Answer by calling plan_folders, once, and write nothing else."],
      [PLANNER_MODEL, asked, "Answer by calling plan_links, once, and write nothing else."],
      [LINK_CHECK_MODEL, asked, "Answer by calling confirm_links, once, and write nothing else."],
      [PLANNER_MODEL, asked, "Answer by calling plan_topic_pages, once, and write nothing else."],
    ]);
  });

  it("sends the same tools and system blocks on every planning call, with the library cached", async () => {
    const { planner: p, requests } = planner([tags, folders, links, verdicts, pages]);

    await p.plan("u", index, { budgetMs: 240_000 });

    const planning = requests.filter((r) => r.model === PLANNER_MODEL);
    expect(new Set(planning.map((r) => JSON.stringify(r.tools))).size).toBe(1);
    expect(new Set(planning.map((r) => JSON.stringify(r.system))).size).toBe(1);
    const system = planning[0]!.system as Anthropic.TextBlockParam[];
    expect(system.at(-1)).toMatchObject({
      text: index.text,
      cache_control: { type: "ephemeral" },
    });
    expect(system[0]).not.toHaveProperty("cache_control");
    expect(planning[0]!.tools!.every((tool) => "strict" in tool && tool.strict === true)).toBe(
      true,
    );
  });

  it("ends quietly when the gateway refuses, keeping what was planned", async () => {
    const { planner: p, requests } = planner([tags, "cap"]);

    const result = await p.plan("u", index, { budgetMs: 240_000 });

    expect(result.capReached).toBe(true);
    expect(requests).toHaveLength(2);
    expect(result.plan.moves).toEqual([]);
  });

  it("sets aside a stage whose output doesn't match its schema and goes on", async () => {
    const { planner: p } = planner([tags, { folders: "nope" }, links, verdicts, pages]);

    const result = await p.plan("u", index, { budgetMs: 240_000 });

    expect(result.notices).toEqual([expect.stringContaining("filing")]);
    expect(result.plan.moves).toEqual([]);
    expect(result.plan.links).toHaveLength(1);
  });

  it("drops the links of a check it can't read", async () => {
    const { planner: p } = planner([tags, folders, links, { verdicts: "nope" }, pages]);

    const result = await p.plan("u", index, { budgetMs: 240_000 });

    expect(result.plan.links).toEqual([]);
    expect(result.notices).toEqual([expect.stringContaining("links were dropped")]);
  });

  it("starts no call without time for it", async () => {
    const { planner: p, requests } = planner([tags]);

    const result = await p.plan("u", index, { budgetMs: 1_000 });

    expect(requests).toEqual([]);
    expect(result.notices.length).toBeGreaterThan(0);
  });
});
