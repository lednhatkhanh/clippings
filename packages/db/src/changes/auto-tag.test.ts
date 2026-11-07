import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TagProposal } from "../clippings/ports.ts";
import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { ChangeConflictError, ChangeNotFoundError, ChangeNotUndoableError } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("auto-tagging", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const high = (name: string, existing: boolean, reason = `It is about ${name}`): TagProposal => ({
    name,
    existing,
    confidence: "high",
    reason,
  });
  const low = (name: string, existing: boolean): TagProposal => ({
    name,
    existing,
    confidence: "low",
    reason: "Maybe",
  });

  /** Saves a page, tells the fake model what to propose for it, and reads it. */
  async function clip(userId: string, url: string, proposals: TagProposal[], tags?: string[]) {
    fixture.web.set(url, {
      page: { title: url, text: "" },
      summary: {
        title: url,
        summary: "",
        excerpt: "",
        suggestedTags: proposals.map((proposal) => proposal.name),
        tagProposals: proposals,
      },
    });
    const { clipping } = await fixture.service.saveClipping(userId, { url, tags, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    fixture.advanceClock(60_000);
    return clipping.id;
  }

  /** A user who already has these tags, on a clipping of their own. */
  async function userWithTags(id: string, names: string[]) {
    const userId = await fixture.createUser(id);
    await fixture.service.saveClipping(userId, {
      url: `https://example.com/${id}-vocabulary`,
      tags: names,
      source: "web",
    });
    return userId;
  }

  const tagNamesOf = async (userId: string, clippingId: string) =>
    (await fixture.service.getClipping(userId, clippingId))?.tags.map((tag) => tag.name);
  const suggestedFor = async (userId: string, clippingId: string) =>
    (await fixture.service.getClipping(userId, clippingId))?.suggestedTags;
  const changeRows = async () =>
    (
      await fixture.pool.query(
        `select user_id, actor, action, target_ids, before, after, confidence, status, reason
           from library_changes order by created_at, id`,
      )
    ).rows;

  describe("applying", () => {
    it("puts a high-confidence existing tag on the clipping and logs it, for a user with no settings row", async () => {
      const ana = await userWithTags("ana", ["css", "rust"]);

      const id = await clip(ana, "https://example.com/a", [high("css", true, "A page on CSS")]);

      expect(await tagNamesOf(ana, id)).toEqual(["css"]);
      const tagId = (await fixture.service.getClipping(ana, id))!.tags[0]!.id;
      expect(await changeRows()).toEqual([
        {
          user_id: ana,
          actor: "auto_tag",
          action: "add_tag",
          target_ids: [id, tagId],
          before: { tags: [] },
          after: { tags: ["css"], tag: { id: tagId, name: "css" } },
          confidence: "high",
          status: "applied",
          reason: "A page on CSS",
        },
      ]);
    });

    it("creates a high-confidence new tag whose name is canonical and logs it as a new tag", async () => {
      const ana = await userWithTags("ana", ["css"]);

      const id = await clip(ana, "https://example.com/a", [high("logistics", false)]);

      expect(await tagNamesOf(ana, id)).toEqual(["logistics"]);
      expect((await changeRows()).map((row) => [row.action, row.confidence, row.status])).toEqual([
        ["create_tag", "high", "applied"],
      ]);
    });

    it("keeps a new tag that fails the canonical-name rule as a suggestion", async () => {
      const ana = await userWithTags("ana", ["web framework"]);
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(ana, "https://example.com/a", [
        high("Web Frameworks", false),
        high("web-framework", false),
        high("databases", false),
      ]);

      expect(await tagNamesOf(ana, id)).toEqual([]);
      expect((await suggestedFor(ana, id))?.toSorted()).toEqual(
        ["Web Frameworks", "databases", "web-framework"].toSorted(),
      );
      expect(await changeRows()).toEqual([]);
    });

    it("leaves a low-confidence tag, existing or new, as a suggestion", async () => {
      const ana = await userWithTags("ana", ["css"]);
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(ana, "https://example.com/a", [low("css", true), low("layout", false)]);

      expect(await tagNamesOf(ana, id)).toEqual([]);
      expect(await suggestedFor(ana, id)).toEqual(["css", "layout"]);
      expect(await changeRows()).toEqual([]);
    });

    it("applies what is certain and suggests the rest of the same reading", async () => {
      const ana = await userWithTags("ana", ["css", "rust"]);
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(ana, "https://example.com/a", [
        high("css", true),
        low("rust", true),
        high("layout", false),
      ]);

      expect(await tagNamesOf(ana, id)).toEqual(["css", "layout"]);
      expect(await suggestedFor(ana, id)).toEqual(["rust"]);
      expect(await changeRows()).toHaveLength(2);
    });

    it("never removes the clipping's own tags, and doesn't log a tag it already carries", async () => {
      const ana = await userWithTags("ana", ["css"]);

      const id = await clip(ana, "https://example.com/a", [high("css", true)], ["Work", "css"]);

      expect(await tagNamesOf(ana, id)).toEqual(["css", "Work"]);
      expect(await changeRows()).toEqual([]);
    });

    it("sends tag names to the model with suggestions off, and applies nothing when the user turned auto-tagging off", async () => {
      const ana = await userWithTags("ana", ["css"]);
      await fixture.settings.setAutoTag(ana, false);
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(ana, "https://example.com/a", [high("css", true)]);

      // Back to suggestions as before: the tag is offered, not applied.
      expect(await tagNamesOf(ana, id)).toEqual([]);
      expect(await suggestedFor(ana, id)).toEqual(["css"]);
      expect(await changeRows()).toEqual([]);
    });

    it("applies nothing from a reading that gave no confidence", async () => {
      const ana = await userWithTags("ana", ["css"]);
      await fixture.settings.setSuggestTags(ana, true);
      fixture.web.set("https://example.com/a", {
        page: { title: "a", text: "" },
        summary: { title: "a", summary: "", excerpt: "", suggestedTags: ["css"] },
      });
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/a",
        source: "web",
      });

      await fixture.service.enrichClipping(clipping.id);

      expect(await tagNamesOf(ana, clipping.id)).toEqual([]);
      expect(await suggestedFor(ana, clipping.id)).toEqual(["css"]);
    });

    it("applies at most the clipping's tag limit and suggests the overflow", async () => {
      const names = Array.from({ length: 21 }, (_, i) => `topic${String.fromCharCode(97 + i)}`);
      // Two clippings carry the vocabulary: one clipping holds at most 20 tags.
      const ana = await userWithTags("ana", names.slice(0, 15));
      await fixture.service.saveClipping(ana, {
        url: "https://example.com/ana-more",
        tags: names.slice(15),
        source: "web",
      });
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(
        ana,
        "https://example.com/a",
        names.map((name) => high(name, true)),
      );

      expect(await tagNamesOf(ana, id)).toHaveLength(20);
      expect(await suggestedFor(ana, id)).toHaveLength(1);
    });

    it("doesn't apply a tag the user dismissed on that clipping, when it is read again", async () => {
      const ana = await userWithTags("ana", ["css"]);
      await fixture.settings.setSuggestTags(ana, true);
      const id = await clip(ana, "https://example.com/a", [low("css", true)]);
      await fixture.service.dismissTagSuggestions(ana, id, ["css"]);
      fixture.web.set("https://example.com/a", {
        page: { title: "a", text: "" },
        summary: {
          title: "a",
          summary: "",
          excerpt: "",
          suggestedTags: ["css"],
          tagProposals: [high("css", true)],
        },
      });

      await fixture.service.reEnrichClipping(ana, id);
      await fixture.service.enrichClipping(id);

      expect(await tagNamesOf(ana, id)).toEqual([]);
      expect(await changeRows()).toEqual([]);
    });

    it("keeps users apart: one user's tags are not applied to another's clipping", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const bob = await fixture.createUser("bob");

      // The model calls "css" one of bob's tags, but he has none: ana's is not his to use.
      const id = await clip(bob, "https://example.com/b", [high("css", true)]);

      expect(await tagNamesOf(bob, id)).toEqual([]);
      expect(await changeRows()).toEqual([]);
      expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual(["css"]);
    });
  });

  describe("listing what was applied", () => {
    it("lists the clipping's automatic tags that it still carries, with the reason", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const id = await clip(ana, "https://example.com/a", [
        high("css", true, "A page on CSS"),
        high("layout", false, "About layout"),
      ]);

      const applied = await fixture.changes.listAutoApplied(ana, id);

      expect(applied.map(({ name, reason, confidence }) => [name, reason, confidence])).toEqual([
        ["css", "A page on CSS", "high"],
        ["layout", "About layout", "high"],
      ]);

      await fixture.service.tagClippings(ana, [id], { remove: ["layout"] });
      expect((await fixture.changes.listAutoApplied(ana, id)).map((tag) => tag.name)).toEqual([
        "css",
      ]);
    });

    it("keeps users apart", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const bob = await fixture.createUser("bob");
      const id = await clip(ana, "https://example.com/a", [high("css", true)]);

      expect(await fixture.changes.listAutoApplied(bob, id)).toEqual([]);
    });
  });

  describe("undoing", () => {
    it("takes the tag off the clipping and marks the change undone, keeping a tag that was already there", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const id = await clip(ana, "https://example.com/a", [high("css", true)]);
      const [applied] = await fixture.changes.listAutoApplied(ana, id);

      const result = await fixture.changes.undoChange(ana, applied!.changeId);

      expect(result).toEqual({
        changeId: applied!.changeId,
        clippingId: id,
        tagId: applied!.tagId,
        removed: true,
      });
      expect(await tagNamesOf(ana, id)).toEqual([]);
      expect((await changeRows()).map((row) => row.status)).toEqual(["undone"]);
      expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual(["css"]);
      expect(await fixture.changes.listAutoApplied(ana, id)).toEqual([]);
    });

    it("removes a tag the change created, unless another clipping carries it", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const first = await clip(ana, "https://example.com/a", [high("layout", false)]);
      const second = await clip(ana, "https://example.com/b", [high("layout", true)]);
      const [created] = await fixture.changes.listAutoApplied(ana, first);

      await fixture.changes.undoChange(ana, created!.changeId);

      expect(await tagNamesOf(ana, first)).toEqual([]);
      // The second clipping uses it, so the tag stays.
      expect(await tagNamesOf(ana, second)).toEqual(["layout"]);
      expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual([
        "css",
        "layout",
      ]);
    });

    it("removes a tag it created when nothing else carries it", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const id = await clip(ana, "https://example.com/a", [high("layout", false)]);
      const [created] = await fixture.changes.listAutoApplied(ana, id);

      await fixture.changes.undoChange(ana, created!.changeId);

      expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual(["css"]);
    });

    it("is not re-applied when the page is read again", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const id = await clip(ana, "https://example.com/a", [high("css", true)]);
      const [applied] = await fixture.changes.listAutoApplied(ana, id);
      await fixture.changes.undoChange(ana, applied!.changeId);

      await fixture.service.reEnrichClipping(ana, id);
      await fixture.service.enrichClipping(id);

      expect(await tagNamesOf(ana, id)).toEqual([]);
      expect((await changeRows()).map((row) => row.status)).toEqual(["undone"]);
    });

    it("refuses, changing nothing, when a later change touched the same clipping and tag", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const id = await clip(ana, "https://example.com/a", [high("css", true)]);
      const [applied] = await fixture.changes.listAutoApplied(ana, id);
      fixture.advanceClock(1000);
      // A later change of the tag itself (phase 3 writes these), logged as applied.
      await fixture.pool.query(
        `insert into library_changes (user_id, actor, action, target_ids, status, created_at)
         values ($1, 'librarian', 'rename_tag', array[$2]::uuid[], 'applied', now() + interval '1 hour')`,
        [ana, applied!.tagId],
      );

      await expect(fixture.changes.undoChange(ana, applied!.changeId)).rejects.toBeInstanceOf(
        ChangeConflictError,
      );

      expect(await tagNamesOf(ana, id)).toEqual(["css"]);
      expect((await changeRows())[0]!.status).toBe("applied");
    });

    it("is not blocked by the same tag added to another clipping", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const first = await clip(ana, "https://example.com/a", [high("css", true)]);
      await clip(ana, "https://example.com/b", [high("css", true)]);
      const [applied] = await fixture.changes.listAutoApplied(ana, first);

      await fixture.changes.undoChange(ana, applied!.changeId);

      expect(await tagNamesOf(ana, first)).toEqual([]);
    });

    it("refuses a change that was already undone, and one that doesn't exist", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const id = await clip(ana, "https://example.com/a", [high("css", true)]);
      const [applied] = await fixture.changes.listAutoApplied(ana, id);
      await fixture.changes.undoChange(ana, applied!.changeId);

      await expect(fixture.changes.undoChange(ana, applied!.changeId)).rejects.toBeInstanceOf(
        ChangeNotUndoableError,
      );
      await expect(
        fixture.changes.undoChange(ana, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toBeInstanceOf(ChangeNotFoundError);
      await expect(fixture.changes.undoChange(ana, "not-an-id")).rejects.toBeInstanceOf(
        ChangeNotFoundError,
      );
    });

    it("marks the change undone without error when the user had already taken the tag off", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const id = await clip(ana, "https://example.com/a", [high("css", true)]);
      const [applied] = await fixture.changes.listAutoApplied(ana, id);
      await fixture.service.tagClippings(ana, [id], { remove: ["css"] });

      const result = await fixture.changes.undoChange(ana, applied!.changeId);

      expect(result.removed).toBe(false);
      expect((await changeRows())[0]!.status).toBe("undone");
    });

    it("keeps users apart: another user can't undo it, and nothing changes", async () => {
      const ana = await userWithTags("ana", ["css"]);
      const bob = await userWithTags("bob", ["css"]);
      const id = await clip(ana, "https://example.com/a", [high("css", true)]);
      const [applied] = await fixture.changes.listAutoApplied(ana, id);

      await expect(fixture.changes.undoChange(bob, applied!.changeId)).rejects.toBeInstanceOf(
        ChangeNotFoundError,
      );

      expect(await tagNamesOf(ana, id)).toEqual(["css"]);
      expect((await changeRows())[0]!.status).toBe("applied");
    });
  });
});
