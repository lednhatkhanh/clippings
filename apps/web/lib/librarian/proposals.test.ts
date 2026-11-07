import { parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import type { LibraryView, LibraryViewItem, LibraryViewTag } from "@clippings/db";

import { indexLibrary } from "./library-index.ts";
import { EMPTY_PLAN, type LibraryPlan } from "./plan.ts";
import { proposalsFromPlan, stableId } from "./proposals.ts";

const NOW = parseISO("2026-11-30T12:00:00Z");
const USER = "user-1";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function tag(n: number, name: string, extra: Partial<LibraryViewTag> = {}): LibraryViewTag {
  return {
    id: id(100 + n),
    name,
    usage: 2,
    folderId: null,
    color: "none",
    colorOverridden: false,
    createdAt: "2026-10-01T00:00:00Z",
    hasTopicPage: false,
    ...extra,
  };
}

function item(n: number, tags: string[], extra: Partial<LibraryViewItem> = {}): LibraryViewItem {
  return {
    id: id(n),
    kind: "link",
    title: `Item ${n}`,
    summary: `About ${tags.join(" and ")}`,
    tags,
    folderId: null,
    savedAt: "2026-11-01T00:00:00Z",
    ...extra,
  };
}

// References follow order: tags T1.., items C1.., folders F1..
const view: LibraryView = {
  totalItems: 5,
  items: [
    item(1, ["css", "css layout"]),
    item(2, ["css"]),
    item(3, ["css"]),
    item(4, ["rust"]),
    item(5, []),
  ],
  tags: [
    tag(1, "css", { usage: 3 }),
    tag(2, "css layout", { usage: 1 }),
    tag(3, "Rust", { usage: 1 }),
    tag(4, "Once", { usage: 1, createdAt: "2026-11-25T00:00:00Z" }),
    tag(5, "Mine", { usage: 0, colorOverridden: true }),
  ],
  folders: [{ id: id(900), name: "Systems", color: "teal" }],
};
const index = indexLibrary(view, NOW);
const high = "high" as const;

const propose = (plan: Partial<LibraryPlan>) =>
  proposalsFromPlan(index, { ...EMPTY_PLAN, ...plan }, { userId: USER });

describe("proposalsFromPlan", () => {
  it("turns merges, renames, folders, moves, links and topic pages into proposals, in that order", () => {
    const { proposals } = propose({
      merges: [{ source: "T2", target: "T1", reason: "Same topic", confidence: high }],
      renames: [{ tag: "T3", name: "rust", reason: "Lowercase", confidence: high }],
      folders: [{ name: "Frontend", color: "blue", reason: "Web styling", confidence: high }],
      moves: [
        { ref: "C1", folder: "Frontend", confidence: high },
        { ref: "T1", folder: "frontend", confidence: high },
      ],
      links: [{ a: "C2", b: "C1", reason: "Both are about css", confidence: high }],
      pages: [
        {
          tag: "T1",
          overview: "What I saved about css.",
          items: [{ ref: "C1", summary: "Grid basics" }],
          confidence: high,
        },
      ],
    });

    const frontend = stableId(USER, "folder", "frontend");
    expect(proposals).toEqual([
      {
        action: "merge_tag",
        sourceId: id(102),
        targetId: id(101),
        reason: "Same topic",
        confidence: high,
      },
      { action: "rename_tag", tagId: id(103), name: "rust", reason: "Lowercase", confidence: high },
      {
        action: "create_folder",
        id: frontend,
        name: "Frontend",
        color: "blue",
        reason: "Web styling",
        confidence: high,
      },
      // The tag moves first; "css" is the merge target, so it is left for the next run.
      {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: id(1),
        folderId: frontend,
        reason: 'Fits the folder "Frontend": Web styling',
        confidence: high,
      },
      {
        action: "link_items",
        id: stableId(USER, "link", `${id(1)}:${id(2)}`),
        fromId: id(1),
        toId: id(2),
        reason: "Both are about css",
        confidence: high,
      },
    ]);
  });

  it("gives the same list for the same library and plan, and ids that depend only on what they name", () => {
    const plan: Partial<LibraryPlan> = {
      folders: [{ name: "Frontend", color: "blue", reason: "Styling", confidence: high }],
      links: [{ a: "C3", b: "C2", reason: "Related", confidence: high }],
    };

    expect(propose(plan)).toEqual(propose(plan));
    expect(stableId(USER, "folder", "x")).toBe(stableId(USER, "folder", "x"));
    expect(stableId(USER, "folder", "x")).not.toBe(stableId("user-2", "folder", "x"));
    expect(stableId(USER, "folder", "x")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("links a pair once, whichever way round, lower id first", () => {
    const { proposals } = propose({
      links: [
        { a: "C2", b: "C1", reason: "One", confidence: high },
        { a: "C1", b: "C2", reason: "Two", confidence: high },
      ],
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ fromId: id(1), toId: id(2), reason: "One" });
  });

  it("reuses a folder the user has instead of creating it again", () => {
    const { proposals } = propose({
      folders: [{ name: "systems", color: "red", reason: "Low level", confidence: high }],
      moves: [{ ref: "C4", folder: "Systems", confidence: high }],
    });

    expect(proposals).toEqual([
      expect.objectContaining({
        action: "move_to_folder",
        itemId: id(4),
        folderId: id(900),
        reason: 'Fits the folder "Systems": Low level',
      }),
    ]);
  });

  it.each([
    ["a tag the library doesn't have", { merges: [{ source: "T99", target: "T1" }] }],
    ["a tag merged into itself", { merges: [{ source: "T1", target: "T1" }] }],
    [
      "a tag in two tag changes",
      {
        merges: [
          { source: "T2", target: "T1" },
          { source: "T3", target: "T1" },
        ],
      },
    ],
  ] as const)("drops %s", (_label, change) => {
    const merges = change.merges.map((m) => ({ ...m, reason: "Same", confidence: high }));
    const { proposals } = propose({ merges });
    expect(proposals.length).toBeLessThan(merges.length);
  });

  it("keeps a tag out of every other change in a list when a merge removes it", () => {
    const { proposals } = propose({
      merges: [{ source: "T2", target: "T1", reason: "Same", confidence: high }],
      renames: [{ tag: "T2", name: "layout", reason: "Shorter", confidence: high }],
      folds: [{ tag: "T2", into: "T1", reason: "Rare", confidence: high }],
      folders: [{ name: "Frontend", color: "blue", reason: "Styling", confidence: high }],
      moves: [{ ref: "T2", folder: "Frontend", confidence: high }],
    });

    expect(proposals.map((p) => p.action)).toEqual(["merge_tag", "create_folder"]);
  });

  describe("folds", () => {
    it("folds a tag used once past the grace period", () => {
      const { proposals } = propose({
        folds: [{ tag: "T3", into: "T1", reason: "Rare", confidence: high }],
      });
      expect(proposals).toMatchObject([
        { action: "fold_tag", sourceId: id(103), targetId: id(101) },
      ]);
    });

    it.each([
      ["a tag younger than 4 weeks", "T4"],
      ["a tag used more than once", "T1"],
    ])("refuses %s", (_label, ref) => {
      const { proposals, notices } = propose({
        folds: [{ tag: ref, into: "T5", reason: "Rare", confidence: high }],
      });
      expect(proposals).toEqual([]);
      expect(notices).toEqual([expect.stringContaining("Set aside 1 planned change")]);
    });
  });

  describe("renames", () => {
    it.each([
      ["not lowercase", "Rust Lang"],
      ["plural", "rusts"],
      ["the same words as another tag", "css"],
      ["the name it already has", "Rust"],
    ])("refuses a name that is %s", (_label, name) => {
      const { proposals } = propose({
        renames: [{ tag: "T3", name, reason: "Tidier", confidence: high }],
      });
      expect(proposals).toEqual([]);
    });
  });

  it("only lists a tag that is too broad as a notice", () => {
    const { proposals, notices } = propose({
      tooBroad: [{ tag: "T1", reason: "It covers layout and animation" }],
    });

    expect(proposals).toEqual([]);
    expect(notices).toEqual(['The tag "css" may be too broad: It covers layout and animation']);
  });

  describe("topic pages", () => {
    const page = (tagRef: string, items: { ref: string; summary: string }[]) => ({
      tag: tagRef,
      overview: "Overview",
      items,
      confidence: high,
    });

    it("renders the page from the overview and the summaries of items the tag has", () => {
      const { proposals } = propose({
        pages: [
          page("T1", [
            { ref: "C1", summary: "Grid <script>alert(1)</script> basics" },
            { ref: "C4", summary: "Not a css item" },
            { ref: "C99", summary: "Made up" },
          ]),
        ],
      });

      expect(proposals).toEqual([
        expect.objectContaining({
          action: "write_topic_page",
          tagId: id(101),
          body: `Overview\n\n## Notes\n\n- [Item 1](/c/${id(1)}): Grid alert(1) basics`,
        }),
      ]);
    });

    it.each([
      ["a tag with fewer than three items", "T3"],
      ["a tag that already has a page", "T1"],
    ])("skips %s", (_label, ref) => {
      const tagged = indexLibrary(
        {
          ...view,
          tags: view.tags.map((t) => (t.name === "css" ? { ...t, hasTopicPage: true } : t)),
        },
        NOW,
      );
      const { proposals } = proposalsFromPlan(
        tagged,
        { ...EMPTY_PLAN, pages: [page(ref, [{ ref: "C1", summary: "x" }])] },
        { userId: USER },
      );
      expect(proposals).toEqual([]);
    });
  });

  it("keeps a reason within the log's limit and drops a change with none", () => {
    const { proposals } = propose({
      merges: [
        { source: "T2", target: "T1", reason: "x".repeat(500), confidence: high },
        { source: "T3", target: "T5", reason: "  ", confidence: high },
      ],
    });

    expect(proposals).toHaveLength(1);
    expect((proposals[0] as { reason: string }).reason).toHaveLength(300);
  });
});
