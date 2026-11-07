import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type LessonQuiz } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { createLessonsService } from "./service.ts";
import {
  LESSON_PAST_LIMIT,
  LESSON_RECENT_LIMIT,
  LESSON_WRITER_STALE_MS,
  type CompletedLesson,
  type LessonsService,
} from "./types.ts";

describe.skipIf(!TEST_DATABASE_URL)("lessons", () => {
  const MINUTE = 60 * 1000;
  const DAY = "2026-10-01";

  const quiz: LessonQuiz = {
    question: "Which one?",
    choices: ["A", "B", "C"],
    answerIndex: 1,
    explanation: "Because B.",
  };

  let fixture: ServiceFixture;
  let lessons: LessonsService;
  let saved = 0;

  beforeEach(async () => {
    saved = 0;
    fixture = await createServiceFixture();
    lessons = createLessonsService({ pool: fixture.pool, clock: fixture.clock });
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** A link the user saved at `at` (ISO), with these tags. */
  async function save(userId: string, at: string, tagNames: string[] = []): Promise<string> {
    saved += 1;
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/page-${saved}`,
      source: "web",
      tags: tagNames,
    });
    await fixture.pool.query(`update clippings set created_at = $2 where id = $1`, [
      clipping.id,
      at,
    ]);
    return clipping.id;
  }

  async function saveNote(
    userId: string,
    at: string,
    body: string,
    tagNames: string[] = [],
  ): Promise<string> {
    const note = await fixture.service.saveNote(userId, { body, tags: tagNames, source: "web" });
    await fixture.pool.query(`update clippings set created_at = $2 where id = $1`, [note.id, at]);
    return note.id;
  }

  async function tagId(userId: string, name: string): Promise<string> {
    const { rows } = await fixture.pool.query(
      `select id from tags where user_id = $1 and name = $2`,
      [userId, name],
    );
    return rows[0].id as string;
  }

  /** A ready lesson for `day`, written the ordinary way. */
  async function readyLesson(
    userId: string,
    day: string,
    extra: Partial<CompletedLesson> = {},
  ): Promise<string> {
    const claim = await lessons.claimLesson(userId, day);
    if (claim.status !== "claimed") throw new Error("not claimed");
    await lessons.completeLesson(userId, claim.lessonId, {
      topic: `Topic ${day}`,
      tagId: null,
      body: `Body ${day}`,
      quiz,
      recap: "",
      sourceIds: [],
      ...extra,
    });
    return claim.lessonId;
  }

  const completed = (extra: Partial<CompletedLesson> = {}): CompletedLesson => ({
    topic: "Container shipping",
    tagId: null,
    body: "A lesson.",
    quiz,
    recap: "Last time...",
    sourceIds: [],
    ...extra,
  });

  describe("claimLesson", () => {
    it("claims the day once; a second claim finds it being written", async () => {
      const ana = await fixture.createUser("ana");

      const first = await lessons.claimLesson(ana, DAY);
      const second = await lessons.claimLesson(ana, DAY);

      expect(first).toEqual({ status: "claimed", lessonId: expect.any(String) });
      expect(second).toEqual({
        status: "exists",
        lessonId: first.status === "claimed" ? first.lessonId : "",
        lessonStatus: "writing",
      });
      expect((await lessons.listLessons(ana)).map((lesson) => lesson.status)).toEqual(["writing"]);
    });

    it("gives each user and each day a lesson of their own", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");

      const results = [
        await lessons.claimLesson(ana, DAY),
        await lessons.claimLesson(bo, DAY),
        await lessons.claimLesson(ana, "2026-10-04"),
      ];

      expect(results.map((result) => result.status)).toEqual(["claimed", "claimed", "claimed"]);
    });

    it("claims once when two claims race", async () => {
      const ana = await fixture.createUser("ana");

      const results = await Promise.all(
        Array.from({ length: 6 }, () => lessons.claimLesson(ana, DAY)),
      );

      expect(results.filter((result) => result.status === "claimed")).toHaveLength(1);
      expect(new Set(results.map((result) => result.lessonId)).size).toBe(1);
    });

    it("takes over a lesson whose writer went stale, not one still fresh", async () => {
      const ana = await fixture.createUser("ana");
      await lessons.claimLesson(ana, DAY);

      fixture.advanceClock(LESSON_WRITER_STALE_MS - MINUTE);
      expect((await lessons.claimLesson(ana, DAY)).status).toBe("exists");

      fixture.advanceClock(2 * MINUTE);
      expect((await lessons.claimLesson(ana, DAY)).status).toBe("claimed");
      // The takeover restarts the writer's clock.
      expect((await lessons.claimLesson(ana, DAY)).status).toBe("exists");
    });

    it("takes up a lesson skipped as failed, clearing why, but not one skipped for good or ready", async () => {
      const ana = await fixture.createUser("ana");

      const failed = await lessons.claimLesson(ana, "2026-10-01");
      if (failed.status !== "claimed") throw new Error("not claimed");
      await lessons.skipLesson(ana, failed.lessonId, { kind: "failed", reason: "Broke" });
      const retried = await lessons.claimLesson(ana, "2026-10-01");
      expect(retried).toEqual({ status: "claimed", lessonId: failed.lessonId });
      expect(await lessons.getLesson(ana, failed.lessonId)).toMatchObject({
        status: "writing",
        skipKind: null,
        skipReason: null,
      });

      for (const [day, kind] of [
        ["2026-10-04", "cap_reached"],
        ["2026-10-08", "nothing_to_teach"],
      ] as const) {
        const claim = await lessons.claimLesson(ana, day);
        if (claim.status !== "claimed") throw new Error("not claimed");
        await lessons.skipLesson(ana, claim.lessonId, { kind, reason: "Why" });
        expect(await lessons.claimLesson(ana, day)).toEqual({
          status: "exists",
          lessonId: claim.lessonId,
          lessonStatus: "skipped",
        });
      }

      const ready = await readyLesson(ana, "2026-10-11");
      expect(await lessons.claimLesson(ana, "2026-10-11")).toEqual({
        status: "exists",
        lessonId: ready,
        lessonStatus: "ready",
      });
    });
  });

  describe("completeLesson and skipLesson", () => {
    it("makes a writing lesson ready, and only a writing one", async () => {
      const ana = await fixture.createUser("ana");
      const claim = await lessons.claimLesson(ana, DAY);
      if (claim.status !== "claimed") throw new Error("not claimed");
      await save(ana, "2026-09-30T10:00:00Z", ["ships"]);
      const tag = await tagId(ana, "ships");

      expect(await lessons.completeLesson(ana, claim.lessonId, completed({ tagId: tag }))).toBe(
        true,
      );

      expect(await lessons.getLesson(ana, claim.lessonId)).toEqual({
        id: claim.lessonId,
        day: DAY,
        status: "ready",
        topic: "Container shipping",
        body: "A lesson.",
        quiz,
        recap: "Last time...",
        sources: [],
        skipKind: null,
        skipReason: null,
        createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-10-01T09:00:00.000Z",
      });
      // Already ready: neither a second completion nor a skip changes it.
      expect(await lessons.completeLesson(ana, claim.lessonId, completed({ topic: "Other" }))).toBe(
        false,
      );
      expect(
        await lessons.skipLesson(ana, claim.lessonId, { kind: "failed", reason: "Late" }),
      ).toBe(false);
      expect(await lessons.getLesson(ana, claim.lessonId)).toMatchObject({
        status: "ready",
        topic: "Container shipping",
      });
      // The writer's mark is cleared, so a ready lesson is never taken over.
      fixture.advanceClock(LESSON_WRITER_STALE_MS * 2);
      expect((await lessons.claimLesson(ana, DAY)).status).toBe("exists");
    });

    it("skips a writing lesson with why, and only a writing one", async () => {
      const ana = await fixture.createUser("ana");
      const claim = await lessons.claimLesson(ana, DAY);
      if (claim.status !== "claimed") throw new Error("not claimed");

      expect(
        await lessons.skipLesson(ana, claim.lessonId, {
          kind: "cap_reached",
          reason: "Today's cap is spent.",
        }),
      ).toBe(true);

      expect(await lessons.getLesson(ana, claim.lessonId)).toMatchObject({
        status: "skipped",
        topic: "",
        body: null,
        quiz: null,
        skipKind: "cap_reached",
        skipReason: "Today's cap is spent.",
      });
      expect(await lessons.completeLesson(ana, claim.lessonId, completed())).toBe(false);
      expect(
        await lessons.skipLesson(ana, claim.lessonId, { kind: "failed", reason: "Again" }),
      ).toBe(false);
    });

    it("keeps sources the user still has, in the order given, and drops the rest", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      const first = await save(ana, "2026-09-30T10:00:00Z");
      const gone = await save(ana, "2026-09-30T11:00:00Z");
      const note = await saveNote(ana, "2026-09-30T12:00:00Z", "My own thoughts");
      const foreign = await save(bo, "2026-09-30T13:00:00Z");
      await fixture.service.deleteClipping(ana, gone);
      const claim = await lessons.claimLesson(ana, DAY);
      if (claim.status !== "claimed") throw new Error("not claimed");

      await lessons.completeLesson(
        ana,
        claim.lessonId,
        completed({
          sourceIds: [note, foreign, gone, first, note, "not-a-uuid"],
        }),
      );

      expect((await lessons.getLesson(ana, claim.lessonId))?.sources).toEqual([
        { id: note, kind: "note", title: expect.any(String) },
        { id: first, kind: "link", title: expect.any(String) },
      ]);
    });

    it("lists a source's current title and leaves out one deleted since", async () => {
      const ana = await fixture.createUser("ana");
      const kept = await save(ana, "2026-09-30T10:00:00Z");
      const later = await save(ana, "2026-09-30T11:00:00Z");
      await fixture.pool.query(`update clippings set user_title = 'Mine' where id = $1`, [kept]);
      const lessonId = await readyLesson(ana, DAY, { sourceIds: [kept, later] });

      await fixture.service.deleteClipping(ana, later);

      expect((await lessons.getLesson(ana, lessonId))?.sources).toEqual([
        { id: kept, kind: "link", title: "Mine" },
      ]);
    });

    it("does not touch another user's lesson", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      const claim = await lessons.claimLesson(ana, DAY);
      if (claim.status !== "claimed") throw new Error("not claimed");

      expect(await lessons.completeLesson(bo, claim.lessonId, completed())).toBe(false);
      expect(
        await lessons.skipLesson(bo, claim.lessonId, { kind: "failed", reason: "Not yours" }),
      ).toBe(false);

      expect((await lessons.getLesson(ana, claim.lessonId))?.status).toBe("writing");
    });
  });

  describe("listLessons and getLesson", () => {
    it("lists the user's lessons newest day first, up to the limit", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      await readyLesson(ana, "2026-10-04");
      await readyLesson(ana, "2026-09-27");
      await readyLesson(ana, "2026-10-08");
      await readyLesson(bo, "2026-10-09");

      expect((await lessons.listLessons(ana)).map((lesson) => lesson.day)).toEqual([
        "2026-10-08",
        "2026-10-04",
        "2026-09-27",
      ]);
      expect((await lessons.listLessons(ana, { limit: 2 })).map((lesson) => lesson.day)).toEqual([
        "2026-10-08",
        "2026-10-04",
      ]);
      expect((await lessons.listLessons(bo)).map((lesson) => lesson.day)).toEqual(["2026-10-09"]);
    });

    it("shows a lesson whose job died mid-write as failed once the stale window is past", async () => {
      const ana = await fixture.createUser("ana");
      const claim = await lessons.claimLesson(ana, DAY);
      if (claim.status !== "claimed") throw new Error("not claimed");

      expect((await lessons.getLesson(ana, claim.lessonId))?.status).toBe("writing");
      fixture.advanceClock(LESSON_WRITER_STALE_MS + MINUTE);
      expect(await lessons.getLesson(ana, claim.lessonId)).toMatchObject({
        status: "skipped",
        skipKind: "failed",
        skipReason: "The job stopped before the lesson was written.",
      });
      // A later delivery may still take it up.
      expect((await lessons.claimLesson(ana, DAY)).status).toBe("claimed");
    });

    it("does not show a source that belongs to someone else", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      const lessonId = await readyLesson(ana, DAY);
      const theirs = await save(bo, "2026-09-30T10:00:00Z");
      // The writer drops foreign ids on completion; a row that has one anyway must not leak it.
      await fixture.pool.query(`update lessons set source_ids = $2 where id = $1`, [
        lessonId,
        [theirs],
      ]);

      expect((await lessons.getLesson(ana, lessonId))?.sources).toEqual([]);
      expect((await lessons.listLessons(ana))[0]?.sources).toEqual([]);
    });

    it("finds a lesson only for its user, and null for an id that is no uuid", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      const lessonId = await readyLesson(ana, DAY);

      expect(await lessons.getLesson(ana, lessonId)).toMatchObject({ id: lessonId });
      expect(await lessons.getLesson(bo, lessonId)).toBeNull();
      expect(await lessons.getLesson(ana, "not-a-uuid")).toBeNull();
      expect(await lessons.getLesson(ana, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });

  describe("readLessonMaterial", () => {
    it("carries the user's profile, empty when they have no settings", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      await fixture.settings.updateResearchSettings(ana, {
        profile: "I run a freight forwarder",
      });

      expect((await lessons.readLessonMaterial(ana, DAY)).profile).toBe(
        "I run a freight forwarder",
      );
      expect((await lessons.readLessonMaterial(bo, DAY)).profile).toBe("");
    });

    it("lists live items saved in the window, newest first, from the start of the UTC day 14 days back", async () => {
      const ana = await fixture.createUser("ana");
      // Now is 2026-10-01T09:00Z, so the window opens at 2026-09-17T00:00Z.
      const before = await save(ana, "2026-09-16T23:59:59Z");
      const edge = await save(ana, "2026-09-17T00:00:00Z");
      const middle = await save(ana, "2026-09-25T08:00:00Z", ["ships"]);
      const note = await saveNote(ana, "2026-09-30T08:00:00Z", "x".repeat(2_500));
      const deleted = await save(ana, "2026-09-30T09:00:00Z");
      await fixture.service.deleteClipping(ana, deleted);
      await fixture.pool.query(
        `update clippings set user_title = 'Mine', summary = 'About ships' where id = $1`,
        [middle],
      );

      const { recent } = await lessons.readLessonMaterial(ana, DAY);

      expect(recent.map((item) => item.id)).toEqual([note, middle, edge]);
      expect(recent).not.toContainEqual(expect.objectContaining({ id: before }));
      expect(recent[1]).toEqual({
        id: middle,
        kind: "link",
        title: "Mine",
        summary: "About ships",
        excerpt: null,
        tagIds: [await tagId(ana, "ships")],
        savedAt: "2026-09-25T08:00:00.000Z",
      });
      expect(recent[0]).toMatchObject({ kind: "note", tagIds: [] });
      expect(recent[0]?.excerpt).toHaveLength(2_000);
    });

    it("lists at most the recent limit", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.pool.query(
        `insert into clippings (user_id, kind, url, url_normalized, title, status, source, created_at, updated_at)
         select $1, 'link', 'https://example.com/' || n, 'https://example.com/' || n, 't', 'pending', 'web',
                '2026-09-30T00:00:00Z'::timestamptz + n * interval '1 minute', now()
         from generate_series(1, $2::int) n`,
        [ana, LESSON_RECENT_LIMIT + 5],
      );

      expect((await lessons.readLessonMaterial(ana, DAY)).recent).toHaveLength(LESSON_RECENT_LIMIT);
    });

    it("describes each tag with a live item: counts, newest item and topic page, most used first", async () => {
      const ana = await fixture.createUser("ana");
      await save(ana, "2026-08-01T10:00:00Z", ["ports"]);
      await save(ana, "2026-08-02T10:00:00Z", ["ports"]);
      await save(ana, "2026-09-28T10:00:00Z", ["ports", "ships"]);
      const gone = await save(ana, "2026-09-29T10:00:00Z", ["empty"]);
      await save(ana, "2026-09-20T10:00:00Z", ["ships"]);
      await fixture.service.deleteClipping(ana, gone);
      await fixture.pool.query(
        `insert into topic_pages (tag_id, user_id, body, source, updated_at) values ($1, $2, 'Ports page', 'ai', '2026-09-30T00:00:00Z')`,
        [await tagId(ana, "ports"), ana],
      );

      const { tags } = await lessons.readLessonMaterial(ana, DAY);

      expect(tags).toEqual([
        {
          id: await tagId(ana, "ports"),
          name: "ports",
          itemCount: 3,
          recentCount: 1,
          newestItemAt: "2026-09-28T10:00:00.000Z",
          topicPage: { body: "Ports page", updatedAt: "2026-09-30T00:00:00.000Z" },
        },
        {
          id: await tagId(ana, "ships"),
          name: "ships",
          itemCount: 2,
          recentCount: 2,
          newestItemAt: "2026-09-28T10:00:00.000Z",
          topicPage: null,
        },
      ]);
    });

    it("lists ready lessons before the day, newest first, not the day itself or others", async () => {
      const ana = await fixture.createUser("ana");
      await save(ana, "2026-09-30T10:00:00Z", ["ports"]);
      const tag = await tagId(ana, "ports");
      await readyLesson(ana, "2026-09-24");
      const latest = await readyLesson(ana, "2026-09-27", { tagId: tag });
      await readyLesson(ana, DAY);
      await readyLesson(ana, "2026-10-04");
      const skipped = await lessons.claimLesson(ana, "2026-09-29");
      if (skipped.status !== "claimed") throw new Error("not claimed");
      await lessons.skipLesson(ana, skipped.lessonId, { kind: "cap_reached", reason: "Cap" });
      await lessons.claimLesson(ana, "2026-09-30");

      const { past } = await lessons.readLessonMaterial(ana, DAY);

      expect(past.map((lesson) => lesson.day)).toEqual(["2026-09-27", "2026-09-24"]);
      expect(past[0]).toEqual({
        id: latest,
        day: "2026-09-27",
        topic: "Topic 2026-09-27",
        tagId: tag,
        body: "Body 2026-09-27",
        quiz,
      });
    });

    it("lists at most the past limit", async () => {
      const ana = await fixture.createUser("ana");
      for (let n = 1; n <= LESSON_PAST_LIMIT + 2; n += 1) {
        await readyLesson(ana, `2026-09-${String(n).padStart(2, "0")}`);
      }

      const { past } = await lessons.readLessonMaterial(ana, DAY);

      expect(past).toHaveLength(LESSON_PAST_LIMIT);
      expect(past[0]?.day).toBe(`2026-09-${String(LESSON_PAST_LIMIT + 2).padStart(2, "0")}`);
    });

    it("keeps users apart: items, tags, topic pages and lessons of another user stay out", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      await save(bo, "2026-09-30T10:00:00Z", ["ports"]);
      await fixture.pool.query(
        `insert into topic_pages (tag_id, user_id, body, source, updated_at) values ($1, $2, 'Bo page', 'ai', '2026-09-30T00:00:00Z')`,
        [await tagId(bo, "ports"), bo],
      );
      await readyLesson(bo, "2026-09-27");
      // Ana has a tag of the same name, with her own item.
      const mine = await save(ana, "2026-09-29T10:00:00Z", ["ports"]);

      const material = await lessons.readLessonMaterial(ana, DAY);

      expect(material.recent.map((item) => item.id)).toEqual([mine]);
      expect(material.tags).toEqual([
        expect.objectContaining({
          id: await tagId(ana, "ports"),
          itemCount: 1,
          topicPage: null,
        }),
      ]);
      expect(material.past).toEqual([]);
    });
  });

  describe("readTopicItems", () => {
    it("lists the live items carrying the tag, newest first, up to the limit", async () => {
      const ana = await fixture.createUser("ana");
      const oldest = await save(ana, "2026-07-01T10:00:00Z", ["ports", "ships"]);
      const newest = await save(ana, "2026-09-01T10:00:00Z", ["ports"]);
      const middle = await saveNote(ana, "2026-08-01T10:00:00Z", "Port notes", ["ports"]);
      await save(ana, "2026-09-02T10:00:00Z", ["ships"]);
      const gone = await save(ana, "2026-09-03T10:00:00Z", ["ports"]);
      await fixture.service.deleteClipping(ana, gone);
      const ports = await tagId(ana, "ports");

      const items = await lessons.readTopicItems(ana, ports, 10);

      expect(items.map((item) => item.id)).toEqual([newest, middle, oldest]);
      expect(items[2]?.tagIds.toSorted()).toEqual([ports, await tagId(ana, "ships")].toSorted());
      expect((await lessons.readTopicItems(ana, ports, 2)).map((item) => item.id)).toEqual([
        newest,
        middle,
      ]);
    });

    it("keeps users apart, and answers nothing for an id that is no uuid", async () => {
      const ana = await fixture.createUser("ana");
      const bo = await fixture.createUser("bo");
      await save(bo, "2026-09-01T10:00:00Z", ["ports"]);
      await save(ana, "2026-09-01T10:00:00Z", ["ports"]);
      const boPorts = await tagId(bo, "ports");

      const items = await lessons.readTopicItems(ana, boPorts, 10);

      expect(items).toEqual([]);
      expect(await lessons.readTopicItems(ana, "not-a-uuid", 10)).toEqual([]);
    });
  });
});
