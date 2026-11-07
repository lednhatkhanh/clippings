import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ChangeConflictError,
  ChangeNotFoundError,
  ChangeNotUndoableError,
} from "../changes/service.ts";
import { InvalidTagsError, TagNameTakenError } from "../clippings/service.ts";
import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { LibrarianInvalidError, LibrarianNotFoundError, type ProposedChange } from "./plans.ts";
import {
  ChangeNotSuggestedError,
  InvalidSuggestionCursorError,
  SuggestionStaleError,
} from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("the librarian", () => {
  let fixture: ServiceFixture;
  let ana: string;
  let ben: string;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    ana = await fixture.createUser("ana");
    ben = await fixture.createUser("ben");
  });

  afterEach(async () => {
    await fixture.close();
  });

  const librarian = () => fixture.librarian;

  async function clip(userId: string, name: string, tags: string[] = []) {
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/${userId}/${name}`,
      tags,
      source: "web",
    });
    fixture.advanceClock(1000);
    return clipping.id;
  }

  async function note(userId: string, body: string) {
    return (await fixture.service.saveNote(userId, { body, source: "web" })).id;
  }

  async function tagId(userId: string, name: string) {
    const tag = await fixture.service.findTagByName(userId, name);
    if (!tag) throw new Error(`No tag ${name}`);
    return tag.id;
  }

  const tagRow = async (id: string) =>
    (
      await fixture.pool.query(
        `select name, color, color_overridden, folder_id from tags where id = $1`,
        [id],
      )
    ).rows[0];

  const changeRows = async (userId: string) =>
    (
      await fixture.pool.query(
        `select actor, action, status, confidence, reason, target_ids, before, after, applied_at
           from library_changes where user_id = $1 order by created_at, id`,
        [userId],
      )
    ).rows;

  /** Proposes one change as the user through Claude and returns the logged change. */
  async function asUser(userId: string, proposal: ProposedChange) {
    const result = await librarian().proposeChange(userId, "user_via_mcp", proposal);
    if (result.outcome !== "applied") throw new Error(`Not applied: ${JSON.stringify(result)}`);
    return result.change;
  }

  const byLibrarian = (userId: string, proposal: ProposedChange) =>
    librarian().proposeChange(userId, "librarian", proposal);

  const high = { confidence: "high", reason: "It fits" } as const;
  const low = { confidence: "low", reason: "Maybe" } as const;

  describe("the confidence gate", () => {
    it("applies a high-confidence change by the librarian and logs it", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));

      const result = await byLibrarian(ana, {
        ...high,
        action: "set_tag_color",
        tagId: t,
        color: "blue",
      });

      expect(result).toMatchObject({
        outcome: "applied",
        change: { actor: "librarian", status: "applied", confidence: "high", reason: "It fits" },
      });
      expect(await tagRow(t)).toMatchObject({ color: "blue", color_overridden: false });
    });

    it("stores a low-confidence change by the librarian as a suggestion and changes nothing", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));

      const result = await byLibrarian(ana, {
        ...low,
        action: "set_tag_color",
        tagId: t,
        color: "blue",
      });

      expect(result).toMatchObject({ outcome: "suggested", change: { status: "suggested" } });
      expect(await tagRow(t)).toMatchObject({ color: "none" });
    });

    it("stores a change with no stated confidence as a suggestion", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));

      const result = await byLibrarian(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "blue",
        reason: "No idea",
      });

      expect(result.outcome).toBe("suggested");
    });

    it("applies a change the user asked for whatever the confidence, and stores everything with suggestOnly", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));
      const proposal = { ...low, action: "set_tag_color", tagId: t, color: "blue" } as const;

      const forced = await librarian().proposeChange(
        ana,
        "librarian",
        { ...proposal, ...high },
        { suggestOnly: true },
      );
      expect(forced.outcome).toBe("suggested");

      const asked = await librarian().proposeChange(ana, "user_via_mcp", proposal);
      expect(asked.outcome).toBe("applied");
    });

    it("writes nothing on a dry run and reports what would happen", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));

      const results = await librarian().proposeChanges(
        ana,
        "librarian",
        [
          { ...high, action: "set_tag_color", tagId: t, color: "blue" },
          { ...low, action: "create_folder", name: "Web" },
        ],
        { dryRun: true },
      );

      expect(results.map((result) => result.outcome)).toEqual(["would_apply", "would_suggest"]);
      expect(await changeRows(ana)).toEqual([]);
      expect(await tagRow(t)).toMatchObject({ color: "none" });
    });
  });

  describe("tag colors", () => {
    it("never overrides a color the user chose, and an MCP color marks it chosen", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));
      await asUser(ana, { action: "set_tag_color", tagId: t, color: "red", reason: "I like red" });
      expect(await tagRow(t)).toMatchObject({ color: "red", color_overridden: true });

      const result = await byLibrarian(ana, {
        ...high,
        action: "set_tag_color",
        tagId: t,
        color: "green",
      });

      expect(result).toMatchObject({ outcome: "skipped" });
      expect(await tagRow(t)).toMatchObject({ color: "red", color_overridden: true });
      // Not even as a suggestion.
      expect((await changeRows(ana)).map((row) => row.status)).toEqual(["applied"]);
    });

    it("lets the user change a color the librarian set, and undoes back to the old state", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));
      await byLibrarian(ana, { ...high, action: "set_tag_color", tagId: t, color: "green" });
      fixture.advanceClock(1000);
      const change = await asUser(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "pink",
        reason: "Mine",
      });
      expect(change.before).toEqual({ color: "green", colorOverridden: false });

      await librarian().undoChange(ana, change.id);

      expect(await tagRow(t)).toMatchObject({ color: "green", color_overridden: false });
    });

    it("gives a tag back its automatic color: none outside a folder, the folder's color inside one", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      await asUser(ana, { action: "set_tag_color", tagId: t, color: "red", reason: "Mine" });
      fixture.advanceClock(1000);

      const auto = await asUser(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "auto",
        reason: "Back to automatic",
      });

      expect(auto).toMatchObject({
        before: { color: "red", colorOverridden: true },
        after: {
          color: "none",
          colorOverridden: false,
          summary: 'Give the tag "css" its automatic color',
        },
      });
      expect(await tagRow(t)).toMatchObject({ color: "none", color_overridden: false });
      // The librarian may color it again now.
      const recolor = await byLibrarian(ana, {
        ...high,
        action: "set_tag_color",
        tagId: t,
        color: "green",
      });
      expect(recolor).toMatchObject({ outcome: "applied" });

      // In a folder the tag takes the folder's color, whatever the user chose.
      fixture.advanceClock(1000);
      const folderId = (
        await asUser(ana, { action: "create_folder", name: "Web", color: "teal", reason: "x" })
      ).targetIds[0]!;
      fixture.advanceClock(1000);
      await asUser(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "pink",
        reason: "Mine again",
      });
      fixture.advanceClock(1000);
      await asUser(ana, {
        action: "move_to_folder",
        itemKind: "tag",
        itemId: t,
        folderId,
        reason: "Fits",
      });
      expect(await tagRow(t)).toMatchObject({ color: "pink", color_overridden: true });
      fixture.advanceClock(1000);

      const inFolder = await asUser(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "auto",
        reason: "Back to automatic",
      });

      expect(inFolder.after).toMatchObject({ color: "teal", colorOverridden: false });
      expect(await tagRow(t)).toMatchObject({ color: "teal", color_overridden: false });

      // Undo puts the user's choice back.
      await librarian().undoChange(ana, inFolder.id);
      expect(await tagRow(t)).toMatchObject({ color: "pink", color_overridden: true });
    });

    it("skips automatic when the tag already has its automatic color", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");

      const result = await librarian().proposeChange(ana, "user_via_mcp", {
        action: "set_tag_color",
        tagId: t,
        color: "auto",
        reason: "x",
      });

      expect(result).toMatchObject({ outcome: "skipped" });
      expect(await changeRows(ana)).toEqual([]);
    });

    it("lets only the user hand a color back, and not for another user's tag", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      await asUser(ana, { action: "set_tag_color", tagId: t, color: "red", reason: "Mine" });

      await expect(
        byLibrarian(ana, { ...high, action: "set_tag_color", tagId: t, color: "auto" }),
      ).rejects.toBeInstanceOf(LibrarianInvalidError);
      await expect(
        librarian().proposeChange(ben, "user_via_mcp", {
          action: "set_tag_color",
          tagId: t,
          color: "auto",
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);
      expect(await tagRow(t)).toMatchObject({ color: "red", color_overridden: true });
    });

    it("refuses a color that is not a palette name", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));
      await expect(
        byLibrarian(ana, { ...high, action: "set_tag_color", tagId: t, color: "#ff0000" as never }),
      ).rejects.toBeInstanceOf(LibrarianInvalidError);
    });
  });

  describe("folders", () => {
    it("creates a folder, files a clipping, a note and a tag in it, and the tag's color follows", async () => {
      const c = await clip(ana, "a", ["css"]);
      const n = await note(ana, "A thought");
      const t = await tagId(ana, "css");

      const folder = await asUser(ana, {
        action: "create_folder",
        name: " Web  dev ",
        color: "teal",
        reason: "A topic",
      });
      const folderId = folder.targetIds[0]!;
      for (const [itemKind, itemId] of [
        ["clipping", c],
        ["clipping", n],
        ["tag", t],
      ] as const) {
        fixture.advanceClock(1000);
        await asUser(ana, { action: "move_to_folder", itemKind, itemId, folderId, reason: "Fits" });
      }

      expect(await fixture.librarian.listFolders(ana)).toEqual([
        { id: folderId, name: "Web dev", color: "teal", clippingCount: 2, tagCount: 1 },
      ]);
      expect(await tagRow(t)).toMatchObject({ color: "teal", folder_id: folderId });
    });

    it("keeps a color the user chose when the tag moves folders", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      await asUser(ana, { action: "set_tag_color", tagId: t, color: "red", reason: "Mine" });
      const folder = await asUser(ana, {
        action: "create_folder",
        name: "Web",
        color: "teal",
        reason: "x",
      });
      fixture.advanceClock(1000);

      await asUser(ana, {
        action: "move_to_folder",
        itemKind: "tag",
        itemId: t,
        folderId: folder.targetIds[0]!,
        reason: "Fits",
      });

      expect(await tagRow(t)).toMatchObject({ color: "red", color_overridden: true });
    });

    it("keeps a color set through the tag service: the librarian neither recolors nor moves it away", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      await fixture.service.setTagColor(ana, t, "red");
      const folder = await asUser(ana, {
        action: "create_folder",
        name: "Web",
        color: "teal",
        reason: "x",
      });
      fixture.advanceClock(1000);

      const recolor = await byLibrarian(ana, {
        ...high,
        action: "set_tag_color",
        tagId: t,
        color: "green",
      });
      await byLibrarian(ana, {
        ...high,
        action: "move_to_folder",
        itemKind: "tag",
        itemId: t,
        folderId: folder.targetIds[0]!,
      });

      expect(recolor.outcome).toBe("skipped");
      expect(await tagRow(t)).toMatchObject({
        color: "red",
        color_overridden: true,
        folder_id: folder.targetIds[0],
      });
    });

    it("skips a duplicate folder name (ignoring case) and a move to where the item already is", async () => {
      const c = await clip(ana, "a");
      const folder = await asUser(ana, { action: "create_folder", name: "Web", reason: "x" });
      const folderId = folder.targetIds[0]!;
      const dup = await librarian().proposeChange(ana, "user_via_mcp", {
        action: "create_folder",
        name: "WEB",
        reason: "x",
      });
      fixture.advanceClock(1000);
      await asUser(ana, {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: c,
        folderId,
        reason: "x",
      });
      fixture.advanceClock(1000);
      const again = await librarian().proposeChange(ana, "user_via_mcp", {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: c,
        folderId,
        reason: "x",
      });

      expect(dup.outcome).toBe("skipped");
      expect(again.outcome).toBe("skipped");
    });

    it("undoes a move to the old folder, and a folder only once it is empty", async () => {
      const c = await clip(ana, "a");
      const folder = await asUser(ana, { action: "create_folder", name: "Web", reason: "x" });
      const folderId = folder.targetIds[0]!;
      fixture.advanceClock(1000);
      const move = await asUser(ana, {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: c,
        folderId,
        reason: "x",
      });

      // The folder was touched by the move, so it can't go first.
      await expect(librarian().undoChange(ana, folder.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      await librarian().undoChange(ana, move.id);
      const { rows } = await fixture.pool.query(`select folder_id from clippings where id = $1`, [
        c,
      ]);
      expect(rows[0].folder_id).toBeNull();

      await librarian().undoChange(ana, folder.id);
      expect(await librarian().listFolders(ana)).toEqual([]);
    });

    it("moves many items into a folder and still undoes the first alone", async () => {
      const a = await clip(ana, "a");
      const b = await clip(ana, "b");
      const folderId = (await asUser(ana, { action: "create_folder", name: "Web", reason: "x" }))
        .targetIds[0]!;
      fixture.advanceClock(1000);
      const first = await asUser(ana, {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: a,
        folderId,
        reason: "x",
      });
      fixture.advanceClock(1000);
      await asUser(ana, {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: b,
        folderId,
        reason: "x",
      });

      await librarian().undoChange(ana, first.id);

      const { rows } = await fixture.pool.query(`select id from clippings where folder_id = $1`, [
        folderId,
      ]);
      expect(rows.map((row) => row.id)).toEqual([b]);
    });

    it("keeps users apart", async () => {
      const c = await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const folderId = (await asUser(ana, { action: "create_folder", name: "Web", reason: "x" }))
        .targetIds[0]!;
      const benClip = await clip(ben, "b", ["css"]);

      // Ben can't use Ana's folder, clipping or tag, and Ana's name is free for him.
      await expect(
        librarian().proposeChange(ben, "user_via_mcp", {
          action: "move_to_folder",
          itemKind: "clipping",
          itemId: benClip,
          folderId,
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);
      const benFolder = await librarian().proposeChange(ben, "user_via_mcp", {
        action: "create_folder",
        name: "Web",
        reason: "x",
      });
      expect(benFolder.outcome).toBe("applied");
      await expect(
        librarian().proposeChange(ben, "user_via_mcp", {
          action: "move_to_folder",
          itemKind: "clipping",
          itemId: c,
          folderId: folderId,
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);
      await expect(
        librarian().proposeChange(ben, "user_via_mcp", {
          action: "set_tag_color",
          tagId: t,
          color: "red",
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);
      expect(await librarian().listFolders(ben)).toHaveLength(1);
      expect(await tagRow(t)).toMatchObject({ color: "none" });
    });

    it("plans a move into a folder created earlier in the same list, applied when that was applied and waiting when it was only suggested", async () => {
      const a = await clip(ana, "a");
      const b = await clip(ben, "b");
      const plan = (
        id: string,
        userId: string,
        confidence: "high" | "low",
        clippingId: string,
      ): ProposedChange[] => [
        { action: "create_folder", id, name: "Web", confidence, reason: "A topic" },
        {
          action: "move_to_folder",
          itemKind: "clipping",
          itemId: clippingId,
          folderId: id,
          ...high,
        },
      ];
      const dry = await librarian().proposeChanges(
        ana,
        "librarian",
        plan(crypto.randomUUID(), ana, "high", a),
        { dryRun: true },
      );
      const applied = await librarian().proposeChanges(
        ana,
        "librarian",
        plan(crypto.randomUUID(), ana, "high", a),
      );
      const waiting = await librarian().proposeChanges(
        ben,
        "librarian",
        plan(crypto.randomUUID(), ben, "low", b),
      );

      expect(dry.map((r) => r.outcome)).toEqual(["would_apply", "would_apply"]);
      expect(applied.map((r) => r.outcome)).toEqual(["applied", "applied"]);
      expect(waiting.map((r) => r.outcome)).toEqual(["suggested", "suggested"]);
    });
  });

  describe("links", () => {
    it("links two items with a reason, once per pair, and undoes it", async () => {
      const a = await clip(ana, "a");
      const n = await note(ana, "A thought");

      const link = await asUser(ana, {
        action: "link_items",
        fromId: a,
        toId: n,
        reason: "Both about CSS",
      });
      const again = await librarian().proposeChange(ana, "user_via_mcp", {
        action: "link_items",
        fromId: n,
        toId: a,
        reason: "Same",
      });
      const rows = await fixture.pool.query(
        `select from_id, to_id, reason, created_by from item_links`,
      );
      expect(rows.rows).toEqual([
        { from_id: a, to_id: n, reason: "Both about CSS", created_by: "user_via_mcp" },
      ]);
      expect(again.outcome).toBe("skipped");

      await librarian().undoChange(ana, link.id);
      expect((await fixture.pool.query(`select 1 from item_links`)).rowCount).toBe(0);
    });

    it("refuses a self link, a missing reason and another user's item", async () => {
      const a = await clip(ana, "a");
      const b = await clip(ana, "b");
      const benClip = await clip(ben, "c");
      const link = (fromId: string, toId: string, reason = "Why") =>
        librarian().proposeChange(ana, "user_via_mcp", {
          action: "link_items",
          fromId,
          toId,
          reason,
        });

      await expect(link(a, a)).rejects.toBeInstanceOf(LibrarianInvalidError);
      await expect(link(a, b, "  ")).rejects.toBeInstanceOf(LibrarianInvalidError);
      await expect(link(a, benClip)).rejects.toBeInstanceOf(LibrarianNotFoundError);
      await expect(link(a, "not-an-id")).rejects.toBeInstanceOf(LibrarianNotFoundError);
    });

    it("does not link a deleted clipping", async () => {
      const a = await clip(ana, "a");
      const b = await clip(ana, "b");
      await fixture.service.deleteClipping(ana, b);

      await expect(
        librarian().proposeChange(ana, "user_via_mcp", {
          action: "link_items",
          fromId: a,
          toId: b,
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);
    });
  });

  describe("topic pages", () => {
    it("writes a page for a tag, rewrites it, and undoes each step", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");

      const first = await byLibrarian(ana, {
        ...high,
        action: "write_topic_page",
        tagId: t,
        body: "# CSS\n\nLayout.",
      });
      fixture.advanceClock(1000);
      const second = await byLibrarian(ana, {
        ...high,
        action: "write_topic_page",
        tagId: t,
        body: "# CSS\n\nLayout and color.",
      });
      const page = () =>
        fixture.pool.query(`select body, source from topic_pages where tag_id = $1`, [t]);
      expect((await page()).rows).toEqual([{ body: "# CSS\n\nLayout and color.", source: "ai" }]);

      if (first.outcome !== "applied" || second.outcome !== "applied")
        throw new Error("not applied");
      await expect(librarian().undoChange(ana, first.change.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      await librarian().undoChange(ana, second.change.id);
      expect((await page()).rows).toEqual([{ body: "# CSS\n\nLayout.", source: "ai" }]);
      await librarian().undoChange(ana, first.change.id);
      expect((await page()).rows).toEqual([]);
    });

    it("refuses a blank body and another user's tag", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");

      await expect(
        byLibrarian(ana, { ...high, action: "write_topic_page", tagId: t, body: " " }),
      ).rejects.toBeInstanceOf(LibrarianInvalidError);
      await expect(
        byLibrarian(ben, { ...high, action: "write_topic_page", tagId: t, body: "Mine" }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);
    });
  });

  describe("renaming and merging tags", () => {
    it("logs a rename and undoes it", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");

      const change = await asUser(ana, {
        action: "rename_tag",
        tagId: t,
        name: "styles",
        reason: "Clearer",
      });
      expect(change).toMatchObject({
        action: "rename_tag",
        before: { name: "css" },
        after: { name: "styles" },
      });
      await librarian().undoChange(ana, change.id);

      expect(await tagRow(t)).toMatchObject({ name: "css" });
    });

    it("refuses a rename to another tag's name, and undo when the old name was taken meanwhile", async () => {
      await clip(ana, "a", ["css", "rust"]);
      const css = await tagId(ana, "css");
      const rename = (name: string) =>
        librarian().proposeChange(ana, "user_via_mcp", {
          action: "rename_tag",
          tagId: css,
          name,
          reason: "x",
        });

      await expect(rename("RUST")).rejects.toBeInstanceOf(TagNameTakenError);
      await expect(rename("  ")).rejects.toBeInstanceOf(InvalidTagsError);
      const renamed = await rename("styles");
      if (renamed.outcome !== "applied") throw new Error("expected it applied");
      await clip(ana, "b", ["css"]);

      await expect(librarian().undoChange(ana, renamed.change.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      expect(await tagRow(css)).toMatchObject({ name: "styles" });
    });

    it("merges a tag and undoes it: the source comes back with its color, folder, topic page and clippings", async () => {
      const a = await clip(ana, "a", ["css", "style"]);
      const b = await clip(ana, "b", ["css"]);
      const c = await clip(ana, "c", ["style"]);
      const css = await tagId(ana, "css");
      const style = await tagId(ana, "style");
      await asUser(ana, { action: "set_tag_color", tagId: css, color: "violet", reason: "Mine" });
      fixture.advanceClock(1000);
      const folderId = (
        await asUser(ana, { action: "create_folder", name: "Web", color: "teal", reason: "x" })
      ).targetIds[0]!;
      fixture.advanceClock(1000);
      await asUser(ana, {
        action: "move_to_folder",
        itemKind: "tag",
        itemId: css,
        folderId,
        reason: "x",
      });
      fixture.advanceClock(1000);
      await byLibrarian(ana, {
        ...high,
        action: "write_topic_page",
        tagId: css,
        body: "CSS notes",
      });
      const tagsOf = async (id: string) =>
        (await fixture.service.getClipping(ana, id))!.tags.map((tag) => tag.name).toSorted();
      const sourceBefore = await tagRow(css);
      fixture.advanceClock(1000);

      const merge = await asUser(ana, {
        action: "merge_tag",
        sourceId: css,
        targetId: style,
        reason: "Same thing",
      });

      expect(await tagsOf(a)).toEqual(["style"]);
      expect(await tagsOf(b)).toEqual(["style"]);
      expect(await tagsOf(c)).toEqual(["style"]);
      expect(await fixture.service.findTagByName(ana, "css")).toBeNull();
      expect(merge).toMatchObject({ action: "merge_tag", targetIds: [css, style] });

      await librarian().undoChange(ana, merge.id);

      expect(await tagRow(css)).toEqual(sourceBefore);
      expect(await tagsOf(a)).toEqual(["css", "style"]);
      expect(await tagsOf(b)).toEqual(["css"]);
      expect(await tagsOf(c)).toEqual(["style"]);
      const page = await fixture.pool.query(`select body from topic_pages where tag_id = $1`, [
        css,
      ]);
      expect(page.rows).toEqual([{ body: "CSS notes" }]);
      expect((await librarian().getChange(ana, merge.id))?.status).toBe("undone");
    });

    it("never deletes a clipping or note when merging", async () => {
      await clip(ana, "a", ["css"]);
      await note(ana, "A thought");
      const css = await tagId(ana, "css");
      const other = await clip(ana, "b", ["style"]).then(() => tagId(ana, "style"));

      await asUser(ana, { action: "merge_tag", sourceId: css, targetId: other, reason: "x" });

      const { rows } = await fixture.pool.query(
        `select count(*)::int as n from clippings where deleted_at is null`,
      );
      expect(rows[0].n).toBe(3);
    });

    it("folds a tag used once, and refuses one used more often", async () => {
      await clip(ana, "a", ["rare", "css"]);
      await clip(ana, "b", ["often"]);
      await clip(ana, "c", ["often"]);
      const [rare, often, css] = await Promise.all(
        ["rare", "often", "css"].map((name) => tagId(ana, name)),
      );

      await expect(
        byLibrarian(ana, { ...high, action: "fold_tag", sourceId: often!, targetId: css! }),
      ).rejects.toBeInstanceOf(LibrarianInvalidError);
      const folded = await byLibrarian(ana, {
        ...high,
        action: "fold_tag",
        sourceId: rare!,
        targetId: css!,
      });

      expect(folded).toMatchObject({ outcome: "applied", change: { action: "fold_tag" } });
      expect(await fixture.service.findTagByName(ana, "rare")).toBeNull();
    });

    it("refuses to merge a tag into itself and into another user's tag", async () => {
      await clip(ana, "a", ["css"]);
      await clip(ben, "b", ["css"]);
      const mine = await tagId(ana, "css");
      const theirs = await tagId(ben, "css");
      const merge = (sourceId: string, targetId: string) =>
        librarian().proposeChange(ana, "user_via_mcp", {
          action: "merge_tag",
          sourceId,
          targetId,
          reason: "x",
        });

      await expect(merge(mine, mine)).rejects.toBeInstanceOf(LibrarianInvalidError);
      await expect(merge(mine, theirs)).rejects.toBeInstanceOf(LibrarianNotFoundError);
      await expect(merge(theirs, mine)).rejects.toBeInstanceOf(LibrarianNotFoundError);
    });

    it("refuses to undo a merge when the source name is in use again", async () => {
      await clip(ana, "a", ["css", "style"]);
      const merge = await asUser(ana, {
        action: "merge_tag",
        sourceId: await tagId(ana, "css"),
        targetId: await tagId(ana, "style"),
        reason: "x",
      });
      await clip(ana, "b", ["CSS"]);

      await expect(librarian().undoChange(ana, merge.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      expect(await fixture.service.findTagByName(ana, "css")).not.toBeNull();
    });

    it("refuses to undo a merge whose new tags a later fold into the same tag relied on, until that fold is undone", async () => {
      const x = await clip(ana, "x", ["a", "c"]);
      const a = await tagId(ana, "a");
      const c = await tagId(ana, "c");
      const t = await clip(ana, "t", ["t"]).then(() => tagId(ana, "t"));
      const mergeA = await asUser(ana, {
        action: "merge_tag",
        sourceId: a,
        targetId: t,
        reason: "x",
      });
      fixture.advanceClock(1000);
      const foldC = await asUser(ana, {
        action: "fold_tag",
        sourceId: c,
        targetId: t,
        reason: "x",
      });

      await expect(librarian().undoChange(ana, mergeA.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      expect(await fixture.service.findTagByName(ana, "a")).toBeNull();
      expect((await fixture.service.getClipping(ana, x))?.tags.map((tag) => tag.name)).toEqual([
        "t",
      ]);

      await librarian().undoChange(ana, foldC.id);
      await librarian().undoChange(ana, mergeA.id);
      expect((await fixture.service.getClipping(ana, x))?.tags.map((tag) => tag.name)).toEqual([
        "a",
        "c",
      ]);
    });
  });

  describe("deleting tags", () => {
    /** A tag with a color, a folder, a topic page and three clippings, one of which also carries another tag. */
    async function arrange() {
      const a = await clip(ana, "a", ["css", "style"]);
      const b = await clip(ana, "b", ["css"]);
      const c = await clip(ana, "c", ["css"]);
      const css = await tagId(ana, "css");
      await asUser(ana, { action: "set_tag_color", tagId: css, color: "violet", reason: "Mine" });
      fixture.advanceClock(1000);
      const folderId = (
        await asUser(ana, { action: "create_folder", name: "Web", color: "teal", reason: "x" })
      ).targetIds[0]!;
      fixture.advanceClock(1000);
      await asUser(ana, {
        action: "move_to_folder",
        itemKind: "tag",
        itemId: css,
        folderId,
        reason: "x",
      });
      fixture.advanceClock(1000);
      await byLibrarian(ana, {
        ...high,
        action: "write_topic_page",
        tagId: css,
        body: "CSS notes",
      });
      fixture.advanceClock(1000);
      return { clippings: [a, b, c], css, folderId };
    }

    const tagsOf = async (id: string) =>
      (await fixture.service.getClipping(ana, id))!.tags.map((tag) => tag.name).toSorted();

    it("deletes a tag from its clippings, logs it, and undo recreates it with color, folder, topic page and clippings", async () => {
      const { clippings: ids, css } = await arrange();
      const before = await tagRow(css);

      const deleted = await asUser(ana, { action: "delete_tag", tagId: css, reason: "Unused" });

      expect(deleted).toMatchObject({
        action: "delete_tag",
        actor: "user_via_mcp",
        targetIds: [css],
        after: { summary: 'Delete the tag "css" from 3 clippings' },
      });
      expect(await fixture.service.findTagByName(ana, "css")).toBeNull();
      expect(await tagsOf(ids[0]!)).toEqual(["style"]);
      expect(await tagsOf(ids[1]!)).toEqual([]);
      expect(
        (await fixture.pool.query(`select 1 from topic_pages where tag_id = $1`, [css])).rows,
      ).toEqual([]);
      // The clippings themselves stay.
      expect(await fixture.service.getClipping(ana, ids[1]!)).not.toBeNull();

      await librarian().undoChange(ana, deleted.id);

      expect(await tagRow(css)).toEqual(before);
      expect(await tagsOf(ids[0]!)).toEqual(["css", "style"]);
      expect(await tagsOf(ids[1]!)).toEqual(["css"]);
      expect(await tagsOf(ids[2]!)).toEqual(["css"]);
      const page = await fixture.pool.query(`select body from topic_pages where tag_id = $1`, [
        css,
      ]);
      expect(page.rows).toEqual([{ body: "CSS notes" }]);
      expect((await librarian().getChange(ana, deleted.id))?.status).toBe("undone");
    });

    it("reports a dry run and writes nothing", async () => {
      await clip(ana, "a", ["css"]);
      const css = await tagId(ana, "css");

      const result = await librarian().proposeChange(
        ana,
        "user_via_mcp",
        { action: "delete_tag", tagId: css, reason: "x" },
        { dryRun: true },
      );

      expect(result).toMatchObject({
        outcome: "would_apply",
        change: { after: { summary: 'Delete the tag "css" from 1 clipping' } },
      });
      expect(await fixture.service.findTagByName(ana, "css")).not.toBeNull();
      expect(await changeRows(ana)).toEqual([]);
    });

    it("only brings back clippings that still exist", async () => {
      const { clippings: ids, css } = await arrange();
      const deleted = await asUser(ana, { action: "delete_tag", tagId: css, reason: "x" });
      await fixture.pool.query(`delete from clippings where id = $1`, [ids[1]]);

      await librarian().undoChange(ana, deleted.id);

      expect(await tagsOf(ids[0]!)).toEqual(["css", "style"]);
      expect(await tagsOf(ids[2]!)).toEqual(["css"]);
    });

    it("refuses to undo when the user has a tag of that name again, and changes nothing", async () => {
      const { css } = await arrange();
      const deleted = await asUser(ana, { action: "delete_tag", tagId: css, reason: "x" });
      await clip(ana, "d", ["CSS"]);

      await expect(librarian().undoChange(ana, deleted.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );

      expect((await librarian().getChange(ana, deleted.id))?.status).toBe("applied");
      expect(await tagRow(css)).toBeUndefined();
    });

    it("can't be undone twice, and a tag that came back can be deleted again", async () => {
      const { css } = await arrange();
      const deleted = await asUser(ana, { action: "delete_tag", tagId: css, reason: "x" });

      await librarian().undoChange(ana, deleted.id);
      await expect(librarian().undoChange(ana, deleted.id)).rejects.toBeInstanceOf(
        ChangeNotUndoableError,
      );
      // The tag is back and deletable again.
      fixture.advanceClock(1000);
      await asUser(ana, { action: "delete_tag", tagId: css, reason: "again" });
      expect(await fixture.service.findTagByName(ana, "css")).toBeNull();
    });

    it("is never the librarian's to propose, and never another user's tag", async () => {
      await clip(ana, "a", ["css"]);
      const css = await tagId(ana, "css");

      await expect(
        byLibrarian(ana, { ...high, action: "delete_tag", tagId: css }),
      ).rejects.toBeInstanceOf(LibrarianInvalidError);
      await expect(
        librarian().proposeChange(ben, "user_via_mcp", {
          action: "delete_tag",
          tagId: css,
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);
      await expect(
        librarian().proposeChange(ana, "user_via_mcp", {
          action: "delete_tag",
          tagId: "not-a-uuid",
          reason: "x",
        }),
      ).rejects.toBeInstanceOf(LibrarianNotFoundError);

      expect(await fixture.service.findTagByName(ana, "css")).not.toBeNull();
      expect(await changeRows(ana)).toEqual([]);
    });
  });

  describe("undo", () => {
    it("refuses when a later applied change touched the same target, and works after that one is undone", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const first = await asUser(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "red",
        reason: "x",
      });
      fixture.advanceClock(1000);
      const second = await asUser(ana, {
        action: "rename_tag",
        tagId: t,
        name: "styles",
        reason: "x",
      });

      await expect(librarian().undoChange(ana, first.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      expect(await tagRow(t)).toMatchObject({ color: "red" });

      await librarian().undoChange(ana, second.id);
      await librarian().undoChange(ana, first.id);
      expect(await tagRow(t)).toMatchObject({ name: "css", color: "none" });
    });

    it("orders changes by when they took effect even with a frozen clock", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const first = await asUser(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "red",
        reason: "x",
      });
      const second = await asUser(ana, {
        action: "rename_tag",
        tagId: t,
        name: "styles",
        reason: "x",
      });

      await expect(librarian().undoChange(ana, first.id)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      await librarian().undoChange(ana, second.id);
    });

    it("is not blocked by a suggestion or a dismissed change, and can't be done twice", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const first = await asUser(ana, {
        action: "set_tag_color",
        tagId: t,
        color: "red",
        reason: "x",
      });
      fixture.advanceClock(1000);
      await librarian().proposeChange(ana, "librarian", {
        ...low,
        action: "rename_tag",
        tagId: t,
        name: "styles",
      });

      await librarian().undoChange(ana, first.id);

      expect(await tagRow(t)).toMatchObject({ color: "none" });
      await expect(librarian().undoChange(ana, first.id)).rejects.toBeInstanceOf(
        ChangeNotUndoableError,
      );
    });

    it("can't undo a suggestion, an unknown change, or another user's change", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const suggestion = await byLibrarian(ana, {
        ...low,
        action: "set_tag_color",
        tagId: t,
        color: "red",
      });
      const applied = await asUser(ana, {
        action: "rename_tag",
        tagId: t,
        name: "styles",
        reason: "x",
      });
      if (suggestion.outcome !== "suggested") throw new Error("expected a suggestion");

      await expect(librarian().undoChange(ana, suggestion.change.id)).rejects.toBeInstanceOf(
        ChangeNotUndoableError,
      );
      await expect(librarian().undoChange(ben, applied.id)).rejects.toBeInstanceOf(
        ChangeNotFoundError,
      );
      await expect(librarian().undoChange(ana, crypto.randomUUID())).rejects.toBeInstanceOf(
        ChangeNotFoundError,
      );
      await expect(librarian().undoChange(ana, "nope")).rejects.toBeInstanceOf(ChangeNotFoundError);
    });

    it("undoes a tag auto-tagging applied, and refuses it after the tag was renamed through the librarian", async () => {
      const userId = await fixture.createUser("cleo");
      await clip(userId, "vocab", ["css"]);
      fixture.web.set("https://example.com/auto", {
        page: { title: "Auto", text: "" },
        summary: {
          title: "Auto",
          summary: "",
          excerpt: "",
          suggestedTags: ["css"],
          tagProposals: [{ name: "css", existing: true, confidence: "high", reason: "CSS" }],
        },
      });
      const { clipping } = await fixture.service.saveClipping(userId, {
        url: "https://example.com/auto",
        source: "web",
      });
      await fixture.service.enrichClipping(clipping.id);
      fixture.advanceClock(1000);
      const [auto] = (await changeRows(userId)).filter((row) => row.actor === "auto_tag");
      expect(auto).toBeDefined();
      const autoId = (
        await fixture.pool.query(
          `select id from library_changes where actor = 'auto_tag' and user_id = $1`,
          [userId],
        )
      ).rows[0].id;
      const t = await tagId(userId, "css");
      const rename = await asUser(userId, {
        action: "rename_tag",
        tagId: t,
        name: "styles",
        reason: "x",
      });

      await expect(librarian().undoChange(userId, autoId)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );
      await librarian().undoChange(userId, rename.id);
      const undone = await librarian().undoChange(userId, autoId);

      expect(undone.status).toBe("undone");
      expect((await fixture.service.getClipping(userId, clipping.id))!.tags).toEqual([]);
    });
  });

  describe("suggestions", () => {
    it("lists a user's suggestions newest first, a page at a time, and not another user's", async () => {
      const t = await clip(ana, "a", ["a1", "a2", "a3"]).then(() =>
        Promise.all(["a1", "a2", "a3"].map((n) => tagId(ana, n))),
      );
      await clip(ben, "b", ["b1"]);
      for (const [index, id] of t.entries()) {
        fixture.advanceClock(1000);
        await byLibrarian(ana, { ...low, action: "set_tag_color", tagId: id, color: "blue" });
        expect(index).toBeGreaterThanOrEqual(0);
      }
      await byLibrarian(ben, {
        ...low,
        action: "set_tag_color",
        tagId: await tagId(ben, "b1"),
        color: "red",
      });
      await asUser(ana, { action: "create_folder", name: "Applied", reason: "x" });

      const first = await librarian().listSuggestions(ana, { limit: 2 });
      const second = await librarian().listSuggestions(ana, {
        limit: 2,
        cursor: first.nextCursor!,
      });

      expect(first.items.map((c) => c.targetIds[0])).toEqual([t[2], t[1]]);
      expect(second.items.map((c) => c.targetIds[0])).toEqual([t[0]]);
      expect(second.nextCursor).toBeNull();
      expect(first.items.every((c) => c.status === "suggested")).toBe(true);
      await expect(librarian().listSuggestions(ana, { cursor: "garbage" })).rejects.toBeInstanceOf(
        InvalidSuggestionCursorError,
      );
    });

    it("applies a suggestion, recomputing the before-state, and the result is undoable", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const suggestion = await byLibrarian(ana, {
        ...low,
        action: "set_tag_color",
        tagId: t,
        color: "blue",
      });
      if (suggestion.outcome !== "suggested") throw new Error("expected a suggestion");
      // The tag changes color by another route in between.
      await fixture.pool.query(`update tags set color = 'amber' where id = $1`, [t]);
      fixture.advanceClock(1000);

      const applied = await librarian().applySuggestion(ana, suggestion.change.id);

      expect(applied).toMatchObject({
        id: suggestion.change.id,
        status: "applied",
        before: { color: "amber" },
      });
      expect(await tagRow(t)).toMatchObject({ color: "blue", color_overridden: false });
      await librarian().undoChange(ana, applied.id);
      expect(await tagRow(t)).toMatchObject({ color: "amber" });
    });

    it("refuses a stale suggestion, changing nothing", async () => {
      await clip(ana, "a", ["css", "style"]);
      const css = await tagId(ana, "css");
      const style = await tagId(ana, "style");
      const suggestion = await byLibrarian(ana, {
        ...low,
        action: "merge_tag",
        sourceId: css,
        targetId: style,
      });
      if (suggestion.outcome !== "suggested") throw new Error("expected a suggestion");
      await asUser(ana, { action: "delete_tag", tagId: css, reason: "Gone" });

      await expect(librarian().applySuggestion(ana, suggestion.change.id)).rejects.toBeInstanceOf(
        SuggestionStaleError,
      );

      expect((await librarian().getChange(ana, suggestion.change.id))?.status).toBe("suggested");
    });

    it("refuses to apply over a color the user has chosen since", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const suggestion = await byLibrarian(ana, {
        ...low,
        action: "set_tag_color",
        tagId: t,
        color: "blue",
      });
      if (suggestion.outcome !== "suggested") throw new Error("expected a suggestion");
      await asUser(ana, { action: "set_tag_color", tagId: t, color: "red", reason: "Mine" });

      await expect(librarian().applySuggestion(ana, suggestion.change.id)).rejects.toBeInstanceOf(
        SuggestionStaleError,
      );
      expect(await tagRow(t)).toMatchObject({ color: "red" });
    });

    it("applies a suggested folder and then the move into it", async () => {
      const a = await clip(ana, "a");
      const folderId = crypto.randomUUID();
      const [create, move] = await librarian().proposeChanges(ana, "librarian", [
        { action: "create_folder", id: folderId, name: "Web", ...low },
        { action: "move_to_folder", itemKind: "clipping", itemId: a, folderId, ...high },
      ]);
      if (create?.outcome !== "suggested" || move?.outcome !== "suggested")
        throw new Error("expected suggestions");

      await expect(librarian().applySuggestion(ana, move.change.id)).rejects.toBeInstanceOf(
        SuggestionStaleError,
      );
      fixture.advanceClock(1000);
      await librarian().applySuggestion(ana, create.change.id);
      fixture.advanceClock(1000);
      await librarian().applySuggestion(ana, move.change.id);

      const { rows } = await fixture.pool.query(`select folder_id from clippings where id = $1`, [
        a,
      ]);
      expect(rows[0].folder_id).toBe(folderId);
    });

    it("dismisses a suggestion, once, and the librarian does not propose it again", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      const proposal = { ...low, action: "set_tag_color", tagId: t, color: "blue" } as const;
      const suggestion = await byLibrarian(ana, proposal);
      if (suggestion.outcome !== "suggested") throw new Error("expected a suggestion");
      const repeat = await byLibrarian(ana, proposal);

      const dismissed = await librarian().dismissSuggestion(ana, suggestion.change.id);
      const after = await byLibrarian(ana, { ...high, ...proposal });
      const other = await byLibrarian(ana, {
        ...low,
        action: "set_tag_color",
        tagId: t,
        color: "red",
      });

      expect(repeat).toMatchObject({
        outcome: "skipped",
        reason: expect.stringContaining("waiting"),
      });
      expect(dismissed.status).toBe("dismissed");
      expect(after).toMatchObject({
        outcome: "skipped",
        reason: expect.stringContaining("dismissed"),
      });
      expect(other.outcome).toBe("suggested");
      await expect(librarian().dismissSuggestion(ana, suggestion.change.id)).rejects.toBeInstanceOf(
        ChangeNotSuggestedError,
      );
      await expect(librarian().applySuggestion(ana, suggestion.change.id)).rejects.toBeInstanceOf(
        ChangeNotSuggestedError,
      );
      expect(await tagRow(t)).toMatchObject({ color: "none" });
    });

    it("does not re-propose a change the user undid", async () => {
      await clip(ana, "a", ["css", "style"]);
      const proposal = {
        ...high,
        action: "merge_tag",
        sourceId: await tagId(ana, "css"),
        targetId: await tagId(ana, "style"),
      } as const;
      const merged = await byLibrarian(ana, proposal);
      if (merged.outcome !== "applied") throw new Error("expected it applied");
      await librarian().undoChange(ana, merged.change.id);

      expect(await byLibrarian(ana, proposal)).toMatchObject({
        outcome: "skipped",
        reason: expect.stringContaining("undid"),
      });
    });

    it("keeps users apart: no seeing, applying, dismissing or deciding on another user's suggestion", async () => {
      await clip(ana, "a", ["css"]);
      const suggestion = await byLibrarian(ana, {
        ...low,
        action: "set_tag_color",
        tagId: await tagId(ana, "css"),
        color: "blue",
      });
      if (suggestion.outcome !== "suggested") throw new Error("expected a suggestion");

      expect((await librarian().listSuggestions(ben)).items).toEqual([]);
      expect(await librarian().getChange(ben, suggestion.change.id)).toBeNull();
      await expect(librarian().applySuggestion(ben, suggestion.change.id)).rejects.toBeInstanceOf(
        ChangeNotFoundError,
      );
      await expect(librarian().dismissSuggestion(ben, suggestion.change.id)).rejects.toBeInstanceOf(
        ChangeNotFoundError,
      );
      expect((await librarian().getChange(ana, suggestion.change.id))?.status).toBe("suggested");
    });
  });

  describe("the change log", () => {
    it("records the actor, confidence, status, reason and before and after of each change", async () => {
      await clip(ana, "a", ["css"]);
      const t = await tagId(ana, "css");
      await byLibrarian(ana, {
        ...high,
        action: "set_tag_color",
        tagId: t,
        color: "blue",
        reason: "CSS is blue",
      });
      fixture.advanceClock(1000);
      await asUser(ana, { action: "rename_tag", tagId: t, name: "styles", reason: "Asked" });

      const rows = await changeRows(ana);

      expect(rows).toMatchObject([
        {
          actor: "librarian",
          action: "set_tag_color",
          status: "applied",
          confidence: "high",
          reason: "CSS is blue",
          target_ids: [t],
          before: { color: "none", colorOverridden: false },
          after: { color: "blue", colorOverridden: false },
        },
        { actor: "user_via_mcp", action: "rename_tag", confidence: null, before: { name: "css" } },
      ]);
      expect(rows.every((row) => row.applied_at)).toBe(true);
    });
  });
  describe("the library view", () => {
    it("lists the user's live items with their tags and folder, and their tags with usage", async () => {
      const first = await clip(ana, "a", ["css", "web"]);
      await clip(ana, "b", ["css"]);
      const gone = await clip(ana, "c", ["css"]);
      await fixture.service.deleteClipping(ana, gone);
      await note(ana, "Remember the grid");
      const css = await tagId(ana, "css");
      const folder = await asUser(ana, {
        action: "create_folder",
        name: "Frontend",
        color: "blue",
        reason: "Asked",
      });
      const folderId = folder.targetIds[0]!;
      await asUser(ana, {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: first,
        folderId,
        reason: "Asked",
      });
      await asUser(ana, {
        action: "write_topic_page",
        tagId: css,
        body: "CSS notes",
        reason: "Asked",
      });

      const view = await librarian().readLibrary(ana);

      expect(view.totalItems).toBe(3);
      expect(view.items).toHaveLength(3);
      expect(view.items.find((item) => item.id === first)).toMatchObject({
        kind: "link",
        tags: ["css", "web"],
        folderId,
      });
      expect(view.items.some((item) => item.id === gone)).toBe(false);
      expect(view.items.find((item) => item.kind === "note")).toMatchObject({
        summary: "Remember the grid",
        tags: [],
        folderId: null,
      });
      expect(view.tags).toMatchObject([
        { name: "css", usage: 2, hasTopicPage: true },
        { name: "web", usage: 1, hasTopicPage: false },
      ]);
      expect(view.folders).toEqual([{ id: folderId, name: "Frontend", color: "blue" }]);
    });

    it("keeps users apart", async () => {
      await clip(ana, "a", ["css"]);
      await clip(ben, "b", ["rust"]);
      await asUser(ben, { action: "create_folder", name: "Systems", reason: "Asked" });

      const view = await librarian().readLibrary(ana);

      expect(view.items).toHaveLength(1);
      expect(view.tags.map((tag) => tag.name)).toEqual(["css"]);
      expect(view.folders).toEqual([]);
    });
  });

  describe("running the librarian", () => {
    it("knows a first run has finished only once it is marked, whatever the log holds", async () => {
      const t = await clip(ana, "a", ["css"]).then(() => tagId(ana, "css"));
      expect(await librarian().hasLibrarianRun(ana)).toBe(false);

      // A first run cut off after it stored a suggestion is still a first run.
      await byLibrarian(ana, { ...low, action: "rename_tag", tagId: t, name: "styles" });
      expect(await librarian().hasLibrarianRun(ana)).toBe(false);

      await librarian().markLibrarianRun(ana);
      await librarian().markLibrarianRun(ana);

      expect(await librarian().hasLibrarianRun(ana)).toBe(true);
      expect(await librarian().hasLibrarianRun(ben)).toBe(false);
    });

    it("lists the users with a clipping or note not deleted", async () => {
      const gone = await clip(ben, "b");
      await fixture.service.deleteClipping(ben, gone);
      const cleo = await fixture.createUser("cleo");
      await note(cleo, "A thought");
      await clip(ana, "a");

      const users = await librarian().listUsersWithLibrary();

      expect(users.toSorted()).toEqual([ana, cleo].toSorted());
    });
  });
});
