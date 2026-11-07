import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("the library views", () => {
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

  async function clip(userId: string, name: string, tags: string[] = []) {
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/${userId}/${name}`,
      tags,
      source: "web",
    });
    fixture.advanceClock(1000);
    return clipping.id;
  }

  async function folder(userId: string, name: string) {
    const result = await fixture.librarian.proposeChange(userId, "user_via_mcp", {
      action: "create_folder",
      name,
      color: "teal",
      reason: "test",
    });
    if (result.outcome !== "applied") throw new Error("not applied");
    return (result.change.after as { folder: { id: string } }).folder.id;
  }

  async function tagId(userId: string, name: string) {
    const tag = await fixture.service.findTagByName(userId, name);
    if (!tag) throw new Error(`No tag ${name}`);
    return tag.id;
  }

  describe("a clipping's placement", () => {
    it("shows its folder and the clippings it links to, from either side", async () => {
      const a = await clip(ana, "a");
      const b = await clip(ana, "b");
      const c = await clip(ana, "c");
      const filing = await folder(ana, "Reading");
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: a,
        folderId: filing,
        reason: "test",
      });
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "link_items",
        fromId: a,
        toId: b,
        reason: "Both about bread",
      });
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "link_items",
        fromId: c,
        toId: a,
        reason: "Same author",
      });

      const placement = await fixture.library.getClippingPlacement(ana, a);
      expect(placement.folder).toEqual({ id: filing, name: "Reading", color: "teal" });
      expect(placement.links.map(({ id, reason }) => ({ id, reason }))).toEqual([
        { id: c, reason: "Same author" },
        { id: b, reason: "Both about bread" },
      ]);
      // The other side sees the same link, pointing back.
      const back = await fixture.library.getClippingPlacement(ana, b);
      expect(back.links.map(({ id }) => id)).toEqual([a]);
      expect(back.folder).toBeNull();
    });

    it("leaves out a link to a clipping in the trash", async () => {
      const a = await clip(ana, "a");
      const b = await clip(ana, "b");
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "link_items",
        fromId: a,
        toId: b,
        reason: "Related",
      });
      await fixture.service.deleteClipping(ana, b);

      expect((await fixture.library.getClippingPlacement(ana, a)).links).toEqual([]);
    });

    it("shows nothing of another user's clipping", async () => {
      const a = await clip(ana, "a");
      const b = await clip(ana, "b");
      const filing = await folder(ana, "Reading");
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: a,
        folderId: filing,
        reason: "test",
      });
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "link_items",
        fromId: a,
        toId: b,
        reason: "Related",
      });

      expect(await fixture.library.getClippingPlacement(ben, a)).toEqual({
        folder: null,
        links: [],
      });
      expect(await fixture.library.getClippingPlacement(ana, "not-an-id")).toEqual({
        folder: null,
        links: [],
      });
    });
  });

  describe("tags", () => {
    it("lists where each tag sits, whose color it is and whether it has a page", async () => {
      await clip(ana, "a", ["bread", "soup"]);
      const filing = await folder(ana, "Cooking");
      const bread = await tagId(ana, "bread");
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "move_to_folder",
        itemKind: "tag",
        itemId: bread,
        folderId: filing,
        reason: "test",
      });
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "write_topic_page",
        tagId: bread,
        body: "# Bread",
        reason: "test",
      });
      const soup = await tagId(ana, "soup");
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "set_tag_color",
        tagId: soup,
        color: "red",
        reason: "test",
      });

      const placements = new Map(
        (await fixture.library.listTagPlacements(ana)).map((row) => [row.tagId, row]),
      );
      expect(placements.get(bread)).toMatchObject({
        folder: { id: filing, name: "Cooking" },
        colorOverridden: false,
        hasTopicPage: true,
      });
      expect(placements.get(soup)).toMatchObject({
        folder: null,
        colorOverridden: true,
        hasTopicPage: false,
      });
      expect(await fixture.library.listTagPlacements(ben)).toEqual([]);
    });

    it("reads a tag's topic page with its clipping count, for its owner only", async () => {
      await clip(ana, "a", ["bread"]);
      await clip(ana, "b", ["bread"]);
      const trashed = await clip(ana, "c", ["bread"]);
      await fixture.service.deleteClipping(ana, trashed);
      const bread = await tagId(ana, "bread");

      const bare = await fixture.library.getTagTopic(ana, bread);
      expect(bare).toMatchObject({ tag: { name: "bread" }, clippingCount: 2, page: null });

      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "write_topic_page",
        tagId: bread,
        body: "# Bread\n\nSourdough notes.",
        reason: "test",
      });
      const topic = await fixture.library.getTagTopic(ana, bread);
      expect(topic?.page).toMatchObject({
        tagId: bread,
        body: "# Bread\n\nSourdough notes.",
        source: "ai",
      });

      expect(await fixture.library.getTagTopic(ben, bread)).toBeNull();
      expect(await fixture.library.getTagTopic(ana, "nope")).toBeNull();
    });
  });

  describe("the log of applied changes", () => {
    it("lists applied changes newest first, not suggestions or undone ones, and only the user's", async () => {
      await clip(ana, "a", ["x", "y"]);
      await clip(ben, "b", ["z"]);
      const x = await tagId(ana, "x");
      const y = await tagId(ana, "y");
      const applied = await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "set_tag_color",
        tagId: x,
        color: "red",
        reason: "first",
      });
      fixture.advanceClock(1000);
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "set_tag_color",
        tagId: y,
        color: "blue",
        reason: "second",
      });
      fixture.advanceClock(1000);
      await fixture.librarian.proposeChange(ana, "librarian", {
        action: "create_folder",
        name: "Maybe",
        reason: "unsure",
        confidence: "low",
      });
      if (applied.outcome !== "applied") throw new Error("not applied");
      expect(await fixture.library.countSuggestions(ana)).toBe(1);
      expect(await fixture.library.countSuggestions(ben)).toBe(0);

      expect((await fixture.library.listAppliedChanges(ana)).map((c) => c.reason)).toEqual([
        "second",
        "first",
      ]);

      await fixture.librarian.undoChange(ana, applied.change.id);
      expect((await fixture.library.listAppliedChanges(ana)).map((c) => c.reason)).toEqual([
        "second",
      ]);
      expect(await fixture.library.listAppliedChanges(ben)).toEqual([]);
    });
  });

  describe("filtering the list by folder", () => {
    it("lists and searches only the clippings in the folder, and none for a stranger's folder", async () => {
      const a = await clip(ana, "a");
      await clip(ana, "b");
      const bens = await clip(ben, "a");
      const filing = await folder(ana, "Reading");
      await fixture.librarian.proposeChange(ana, "user_via_mcp", {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: a,
        folderId: filing,
        reason: "test",
      });
      const otherFiling = await folder(ben, "Reading");
      await fixture.librarian.proposeChange(ben, "user_via_mcp", {
        action: "move_to_folder",
        itemKind: "clipping",
        itemId: bens,
        folderId: otherFiling,
        reason: "test",
      });

      const listed = await fixture.service.listClippings(ana, { folderId: filing });
      expect(listed.items.map((c) => c.id)).toEqual([a]);
      expect((await fixture.service.listClippings(ana, { folderId: otherFiling })).items).toEqual(
        [],
      );
      expect((await fixture.service.listClippings(ana, { folderId: "not-an-id" })).items).toEqual(
        [],
      );
      expect((await fixture.service.listClippings(ana, {})).items).toHaveLength(2);

      const found = await fixture.service.searchClippings(ana, { q: "example", folderId: filing });
      expect(found.items.map((hit) => hit.clipping.id)).toEqual([a]);
    });
  });
});
