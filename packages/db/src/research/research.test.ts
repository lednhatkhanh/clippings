import { addHours, subHours } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatIsoUtc, MAX_BRIEF_LENGTH } from "@clippings/shared";

import { createDatabase } from "../database.ts";
import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("research briefs", () => {
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;

  let fixture: ServiceFixture;
  let saved = 0;

  beforeEach(async () => {
    saved = 0;
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** A link the user saved, still pending: a brief needs only the clipping row. */
  async function save(userId: string): Promise<string> {
    saved += 1;
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/page-${saved}`,
      source: "web",
    });
    return clipping.id;
  }

  /** Queues a brief for a new clipping of the user, a minute after the last. */
  async function queue(
    userId: string,
    domain = "shipping",
  ): Promise<{ id: string; brief: string }> {
    const clippingId = await save(userId);
    fixture.advanceClock(MINUTE);
    await fixture.research.queueBrief(createDatabase(fixture.pool), {
      userId,
      clippingId,
      domain,
      reason: "About ports",
    });
    const brief = await fixture.research.getBrief(userId, clippingId);
    return { id: clippingId, brief: brief!.id };
  }

  /** Claims every queued brief and puts the claimed ones in a batch, as the daily run does. */
  async function sendBatch(batchId: string): Promise<string[]> {
    const claims = await fixture.research.claimForBatch(fixture.clock.now());
    const ids = claims.flatMap(({ briefs }) => briefs.map((brief) => brief.id));
    await fixture.research.attachBatch(ids, batchId);
    return ids;
  }

  /** A brief that went through the batch up to `submitted`; no other brief is queued. */
  async function submitted(userId: string, batchId = "batch_1") {
    const queued = await queue(userId);
    expect(await sendBatch(batchId)).toEqual([queued.brief]);
    return queued;
  }

  const submissionRows = async (briefId: string) =>
    (await fixture.pool.query(`select * from research_submissions where brief_id = $1`, [briefId]))
      .rows;

  /** A brief being written for the user, asked for by hand. */
  async function writing(userId: string) {
    const clippingId = await save(userId);
    const result = await fixture.research.requestBriefNow(userId, clippingId);
    if (result.status !== "started") throw new Error(`Not started: ${result.status}`);
    return { id: clippingId, brief: result.brief.id };
  }

  async function row(briefId: string) {
    const { rows } = await fixture.pool.query(`select * from research_briefs where id = $1`, [
      briefId,
    ]);
    return rows[0] as Record<string, unknown>;
  }

  describe("queueBrief", () => {
    it("queues a brief for the clipping, with the verdict's domain and reason", async () => {
      const ana = await fixture.createUser("ana");
      const clippingId = await save(ana);

      const queued = await fixture.research.queueBrief(createDatabase(fixture.pool), {
        userId: ana,
        clippingId,
        domain: "shipping",
        reason: "A port strike",
      });

      expect(queued).toBe(true);
      expect(await fixture.research.getBrief(ana, clippingId)).toEqual({
        id: expect.any(String),
        clippingId,
        domain: "shipping",
        reason: "A port strike",
        status: "queued",
        mode: "batch",
        body: null,
        sources: [],
        note: null,
        createdAt: "2026-10-01T09:00:00.000Z",
        updatedAt: "2026-10-01T09:00:00.000Z",
        completedAt: null,
      });
    });

    it("runs in the caller's transaction: rolled back with it, and visible only once it commits", async () => {
      const ana = await fixture.createUser("ana");
      const kept = await save(ana);
      const undone = await save(ana);
      const db = createDatabase(fixture.pool);

      await db.transaction(async (tx) => {
        await fixture.research.queueBrief(tx, {
          userId: ana,
          clippingId: kept,
          domain: "shipping",
          reason: "r",
        });
        expect(await fixture.research.getBrief(ana, kept)).toBeNull();
      });
      await db
        .transaction(async (tx) => {
          await fixture.research.queueBrief(tx, {
            userId: ana,
            clippingId: undone,
            domain: "shipping",
            reason: "r",
          });
          throw new Error("enrichment failed");
        })
        .catch(() => undefined);

      expect(await fixture.research.getBrief(ana, kept)).toMatchObject({ status: "queued" });
      expect(await fixture.research.getBrief(ana, undone)).toBeNull();
    });

    it("keeps the first brief of a clipping: there is one per clipping", async () => {
      const ana = await fixture.createUser("ana");
      const clippingId = await save(ana);
      const db = createDatabase(fixture.pool);
      const input = { userId: ana, clippingId, domain: "shipping", reason: "First" };
      await fixture.research.queueBrief(db, input);

      const again = await fixture.research.queueBrief(db, {
        ...input,
        domain: "logistics",
        reason: "Second",
      });

      expect(again).toBe(false);
      expect(await fixture.research.getBrief(ana, clippingId)).toMatchObject({
        domain: "shipping",
        reason: "First",
      });
      const { rows } = await fixture.pool.query(`select count(*)::int as n from research_briefs`);
      expect(rows[0].n).toBe(1);
    });

    it("refuses a clipping that belongs to another user", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const clippingId = await save(ana);

      await expect(
        fixture.research.queueBrief(createDatabase(fixture.pool), {
          userId: ben,
          clippingId,
          domain: "shipping",
          reason: "r",
        }),
      ).rejects.toThrow();

      expect(await fixture.research.getBrief(ana, clippingId)).toBeNull();
    });
  });

  describe("getBrief", () => {
    it("is null for a clipping without a brief, or an id that isn't one", async () => {
      const ana = await fixture.createUser("ana");
      const clippingId = await save(ana);

      expect(await fixture.research.getBrief(ana, clippingId)).toBeNull();
      expect(await fixture.research.getBrief(ana, "not-a-uuid")).toBeNull();
    });

    it("keeps users apart: another user's brief is never returned", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const { id } = await queue(ana);

      expect(await fixture.research.getBrief(ben, id)).toBeNull();
      expect(await fixture.research.getBrief(ana, id)).not.toBeNull();
    });

    it("hides the brief of a deleted clipping until the clipping is restored", async () => {
      const ana = await fixture.createUser("ana");
      const { id } = await queue(ana);

      await fixture.service.deleteClipping(ana, id);
      expect(await fixture.research.getBrief(ana, id)).toBeNull();

      await fixture.service.restoreClipping(ana, id);
      expect(await fixture.research.getBrief(ana, id)).toMatchObject({ status: "queued" });
    });
  });

  describe("requestBriefNow", () => {
    it("makes a brief by hand for a clipping with none, and starts writing it", async () => {
      const ana = await fixture.createUser("ana");
      const clippingId = await save(ana);

      const result = await fixture.research.requestBriefNow(ana, clippingId);

      expect(result).toEqual({
        status: "started",
        brief: expect.objectContaining({
          clippingId,
          domain: "",
          reason: "Asked for by hand",
          status: "writing",
          mode: "now",
        }),
      });
      const stored = await row((result as { brief: { id: string } }).brief.id);
      expect(stored).toMatchObject({ attempts: 1, user_id: ana });
      expect(stored.submitted_at).toEqual(fixture.clock.now());
      expect(await fixture.research.submissionsToday(ana)).toBe(1);
    });

    it("takes up a queued brief and keeps what the verdict said", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await queue(ana, "logistics");
      fixture.advanceClock(HOUR);

      const result = await fixture.research.requestBriefNow(ana, queued.id);

      expect(result).toEqual({
        status: "started",
        brief: expect.objectContaining({
          id: queued.brief,
          domain: "logistics",
          reason: "About ports",
          status: "writing",
          mode: "now",
          updatedAt: "2026-10-01T10:01:00.000Z",
        }),
      });
      expect(await row(queued.brief)).toMatchObject({ attempts: 1 });
    });

    it("tries a dropped brief again", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await submitted(ana);
      await fixture.research.failBrief(queued.brief, "the batch expired");
      await sendBatch("batch_2");
      await fixture.research.failBrief(queued.brief, "the batch expired");
      expect((await fixture.research.getBrief(ana, queued.id))?.status).toBe("dropped");

      const result = await fixture.research.requestBriefNow(ana, queued.id);

      expect(result).toMatchObject({ status: "started", brief: { status: "writing", note: null } });
      expect(await row(queued.brief)).toMatchObject({
        attempts: 3,
        batch_id: null,
        completed_at: null,
      });
    });

    it.each(["submitted", "writing", "ready"] as const)(
      "is busy with a %s brief",
      async (status) => {
        const ana = await fixture.createUser("ana");
        const queued = await queue(ana);
        if (status === "submitted") await sendBatch("batch_1");
        else {
          await fixture.research.requestBriefNow(ana, queued.id);
          if (status === "ready") {
            await fixture.research.completeBrief(queued.brief, { body: "Done", sources: [] });
          }
        }
        const before = await row(queued.brief);

        expect(await fixture.research.requestBriefNow(ana, queued.id)).toEqual({ status: "busy" });

        expect(await row(queued.brief)).toEqual(before);
      },
    );

    it("is not found for another user's clipping, a deleted one, or one that doesn't exist", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const { id, brief } = await queue(ana);
      const deleted = await save(ana);
      await fixture.service.deleteClipping(ana, deleted);

      expect(await fixture.research.requestBriefNow(ben, id)).toEqual({ status: "not_found" });
      expect(await fixture.research.requestBriefNow(ana, deleted)).toEqual({ status: "not_found" });
      expect(await fixture.research.requestBriefNow(ana, crypto.randomUUID())).toEqual({
        status: "not_found",
      });
      expect(await fixture.research.requestBriefNow(ana, "nope")).toEqual({ status: "not_found" });
      expect(await row(brief)).toMatchObject({ status: "queued", attempts: 0 });
    });

    it("stops at the user's research jobs for the day, whatever started them", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 3 });
      await submitted(ana);
      await writing(ana);
      await writing(ana);
      const fourth = await save(ana);

      expect(await fixture.research.requestBriefNow(ana, fourth)).toEqual({
        status: "limit_reached",
      });

      expect(await fixture.research.getBrief(ana, fourth)).toBeNull();
      expect(await fixture.research.submissionsToday(ana)).toBe(3);
    });

    it("uses the default of 3 for a user who never set a limit, and refuses at 0", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateAutomationSettings(ben, { researchJobsPerDay: 0 });
      for (let i = 0; i < 3; i++) await writing(ana);

      expect(await fixture.research.requestBriefNow(ana, await save(ana))).toEqual({
        status: "limit_reached",
      });
      expect(await fixture.research.requestBriefNow(ben, await save(ben))).toEqual({
        status: "limit_reached",
      });
    });

    it("keeps users apart: one user's submissions don't use up another's limit", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 1 });
      await fixture.settings.updateAutomationSettings(ben, { researchJobsPerDay: 1 });
      await writing(ben);

      const result = await fixture.research.requestBriefNow(ana, await save(ana));

      expect(result.status).toBe("started");
      expect(await fixture.research.submissionsToday(ana)).toBe(1);
      expect(await fixture.research.submissionsToday(ben)).toBe(1);
    });

    it("starts counting again at 00:00 UTC", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 1 });
      await writing(ana);
      const next = await save(ana);

      // The clock reads 09:00 UTC: the last millisecond of the day is 15 hours less one away.
      fixture.advanceClock(15 * HOUR - 1);
      expect(await fixture.research.requestBriefNow(ana, next)).toEqual({
        status: "limit_reached",
      });
      expect(await fixture.research.submissionsToday(ana)).toBe(1);

      fixture.advanceClock(1);
      expect(await fixture.research.submissionsToday(ana)).toBe(0);
      expect((await fixture.research.requestBriefNow(ana, next)).status).toBe("started");
    });
  });

  describe("claimForBatch", () => {
    it("claims each user's oldest queued briefs, with what the writer needs, and submits them", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateResearchSettings(ana, { profile: "Backend dev at a shipper" });
      fixture.web.set("https://example.com/page-1", {
        page: { title: "Ports | Example", text: "The port of Rotterdam handles containers." },
        summary: { title: "Ports", summary: "About ports.", excerpt: "The port of Rotterdam" },
      });
      const first = await queue(ana);
      const second = await queue(ben, "logistics");
      await fixture.service.enrichClipping(first.id);
      const note = await fixture.service.saveNote(ana, {
        body: "Idea: track vessels",
        source: "web",
      });
      await fixture.service.updateClipping(ana, note.id, { title: "Vessel idea" });
      await fixture.research.queueBrief(createDatabase(fixture.pool), {
        userId: ana,
        clippingId: note.id,
        domain: "shipping",
        reason: "A note",
      });
      fixture.advanceClock(HOUR);

      const claims = await fixture.research.claimForBatch(fixture.clock.now());

      expect(claims.map((claim) => claim.userId)).toEqual([ana, ben]);
      expect(claims[0]!.briefs).toEqual([
        {
          id: first.brief,
          userId: ana,
          clippingId: first.id,
          domain: "shipping",
          reason: "About ports",
          profile: "Backend dev at a shipper",
          clipping: {
            kind: "link",
            url: "https://example.com/page-1",
            title: "Ports",
            summary: "About ports.",
            excerpt: "The port of Rotterdam",
            body: null,
          },
          pageText: "The port of Rotterdam handles containers.",
        },
        expect.objectContaining({
          clippingId: note.id,
          profile: "Backend dev at a shipper",
          clipping: expect.objectContaining({
            kind: "note",
            url: null,
            title: "Vessel idea",
            body: "Idea: track vessels",
          }),
          pageText: null,
        }),
      ]);
      expect(claims[1]!.briefs).toEqual([
        expect.objectContaining({
          id: second.brief,
          userId: ben,
          domain: "logistics",
          profile: "",
          pageText: null,
        }),
      ]);
      // Claimed means submitted: one more attempt, a job of the day used, no batch yet.
      expect(await row(first.brief)).toMatchObject({
        status: "submitted",
        mode: "batch",
        attempts: 1,
        batch_id: null,
        submitted_at: fixture.clock.now(),
      });
      expect(await submissionRows(first.brief)).toHaveLength(1);
      expect(await fixture.research.submissionsToday(ana)).toBe(2);
      expect(await fixture.research.submissionsToday(ben)).toBe(1);
      expect(await fixture.research.submittedBatchIds()).toEqual([]);
      expect(await fixture.research.claimForBatch(fixture.clock.now())).toEqual([]);
    });

    it("takes the oldest first, up to what the user has left of the day's research jobs", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 2 });
      const anaFirst = await queue(ana);
      const benOnly = await queue(ben);
      const anaSecond = await queue(ana);
      const anaThird = await queue(ana);

      const claims = await fixture.research.claimForBatch(fixture.clock.now());

      expect(claims).toEqual([
        {
          userId: ana,
          briefs: [
            expect.objectContaining({ id: anaFirst.brief }),
            expect.objectContaining({ id: anaSecond.brief }),
          ],
        },
        { userId: ben, briefs: [expect.objectContaining({ id: benOnly.brief })] },
      ]);
      expect(await row(anaThird.brief)).toMatchObject({ status: "queued", attempts: 0 });
    });

    it("counts submissions made today by batch and by hand against the limit, per user", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 3 });
      await fixture.settings.updateAutomationSettings(ben, { researchJobsPerDay: 3 });
      await submitted(ana);
      await writing(ana);
      const left = await queue(ana);
      await queue(ana);
      const benFirst = await queue(ben);
      const benSecond = await queue(ben);

      const claims = await fixture.research.claimForBatch(fixture.clock.now());

      expect(claims.map(({ userId, briefs }) => [userId, briefs.map((b) => b.id)])).toEqual([
        [ana, [left.brief]],
        [ben, [benFirst.brief, benSecond.brief]],
      ]);
    });

    it("leaves out a user who has used the day's jobs, and yesterday's submissions don't count", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 1 });
      await writing(ana);
      const waiting = await queue(ana);

      expect(await fixture.research.claimForBatch(fixture.clock.now())).toEqual([]);

      fixture.advanceClock(24 * HOUR);
      const claims = await fixture.research.claimForBatch(fixture.clock.now());
      expect(claims.map(({ briefs }) => briefs.map((b) => b.id))).toEqual([[waiting.brief]]);
    });

    it("judges the day by the time it is given", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 1 });
      await writing(ana);
      await queue(ana);
      const tomorrow = addHours(fixture.clock.now(), 24);

      expect(await fixture.research.claimForBatch(fixture.clock.now())).toEqual([]);
      expect(await fixture.research.claimForBatch(tomorrow)).toHaveLength(1);
    });

    it("never claims a brief of a deleted clipping, until the clipping is restored", async () => {
      const ana = await fixture.createUser("ana");
      const gone = await queue(ana);
      const kept = await queue(ana);
      await fixture.service.deleteClipping(ana, gone.id);

      const claims = await fixture.research.claimForBatch(fixture.clock.now());

      expect(claims.flatMap(({ briefs }) => briefs.map((b) => b.id))).toEqual([kept.brief]);

      await fixture.service.restoreClipping(ana, gone.id);
      const restored = await fixture.research.claimForBatch(fixture.clock.now());
      expect(restored.flatMap(({ briefs }) => briefs.map((b) => b.id))).toEqual([gone.brief]);
    });

    it("a deleted clipping doesn't take one of the user's jobs for the day", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 1 });
      const gone = await queue(ana);
      const kept = await queue(ana);
      await fixture.service.deleteClipping(ana, gone.id);

      const claims = await fixture.research.claimForBatch(fixture.clock.now());

      expect(claims.flatMap(({ briefs }) => briefs.map((b) => b.id))).toEqual([kept.brief]);
    });

    it("claims only queued briefs", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 10 });
      await submitted(ana);
      await writing(ana);
      const ready = await writing(ana);
      await fixture.research.completeBrief(ready.brief, { body: "Done", sources: [] });
      const queued = await queue(ana);

      const claims = await fixture.research.claimForBatch(fixture.clock.now());

      expect(claims.flatMap(({ briefs }) => briefs.map((b) => b.id))).toEqual([queued.brief]);
    });

    it("never gives the same brief to two overlapping claims, and keeps to the limit", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 3 });
      const anas = [await queue(ana), await queue(ana), await queue(ana), await queue(ana)];
      const bens = [await queue(ben), await queue(ben)];

      const runs = await Promise.all(
        Array.from({ length: 4 }, () => fixture.research.claimForBatch(fixture.clock.now())),
      );

      const claimed = runs.flatMap((claims) =>
        claims.flatMap(({ briefs }) => briefs.map((b) => b.id)),
      );
      expect(new Set(claimed).size).toBe(claimed.length);
      const byUser = (userId: string) =>
        runs.flatMap((claims) =>
          claims.filter((claim) => claim.userId === userId).flatMap(({ briefs }) => briefs),
        );
      expect(byUser(ana)).toHaveLength(3);
      expect(byUser(ana).map((b) => b.id)).toEqual(
        expect.arrayContaining(anas.slice(0, 3).map((q) => q.brief)),
      );
      expect(
        byUser(ben)
          .map((b) => b.id)
          .toSorted(),
      ).toEqual(bens.map((q) => q.brief).toSorted());
      expect(await fixture.research.submissionsToday(ana)).toBe(3);
    });

    it("can't be raced by a write-now: a claimed brief is busy, and a taken one isn't claimed", async () => {
      const ana = await fixture.createUser("ana");
      const claimedFirst = await queue(ana);
      await fixture.research.claimForBatch(fixture.clock.now());

      expect(await fixture.research.requestBriefNow(ana, claimedFirst.id)).toEqual({
        status: "busy",
      });
      expect(await row(claimedFirst.brief)).toMatchObject({ status: "submitted", attempts: 1 });

      const raced = await queue(ana);
      const [claims, request] = await Promise.all([
        fixture.research.claimForBatch(fixture.clock.now()),
        fixture.research.requestBriefNow(ana, raced.id),
      ]);

      const claimed = claims.flatMap(({ briefs }) => briefs.map((b) => b.id));
      expect(claimed.length + (request.status === "started" ? 1 : 0)).toBe(1);
      expect(await row(raced.brief)).toMatchObject({
        status: claimed.length === 1 ? "submitted" : "writing",
        attempts: 1,
      });
      expect(await submissionRows(raced.brief)).toHaveLength(1);
    });

    it("leaves a user with no research domains their queued briefs from a verdict, and sends the ones asked for by hand", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateResearchSettings(ben, { domains: [] });
      const anaVerdict = await queue(ana);
      const benVerdict = await queue(ben);
      const benByHand = await writing(ben);
      await fixture.research.failBrief(benByHand.brief, "the model refused");

      const claims = await fixture.research.claimForBatch(fixture.clock.now());

      expect(claims.map(({ userId, briefs }) => [userId, briefs.map((b) => b.id)])).toEqual([
        [ana, [anaVerdict.brief]],
        [ben, [benByHand.brief]],
      ]);
      expect(await row(benVerdict.brief)).toMatchObject({ status: "queued", attempts: 0 });
      expect(await fixture.research.submissionsToday(ben)).toBe(2);
    });
  });

  describe("attachBatch", () => {
    it("names the batch of the claimed briefs, and lists it with their owners", async () => {
      const ana = await fixture.createUser("ana");
      const one = await queue(ana);
      const two = await queue(ana);
      fixture.advanceClock(HOUR);
      await fixture.research.claimForBatch(fixture.clock.now());

      const moved = await fixture.research.attachBatch([one.brief, two.brief], "batch_a");

      expect(moved).toBe(2);
      expect(await row(one.brief)).toMatchObject({ status: "submitted", batch_id: "batch_a" });
      expect(await fixture.research.submittedBatchIds()).toEqual(["batch_a"]);
      expect(await fixture.research.briefsInBatch("batch_a")).toEqual([
        { id: one.brief, userId: ana },
        { id: two.brief, userId: ana },
      ]);
    });

    it("moves only a submitted brief that has no batch yet", async () => {
      const ana = await fixture.createUser("ana");
      const inBatch = await submitted(ana, "batch_a");
      const ready = await writing(ana);
      await fixture.research.completeBrief(ready.brief, { body: "Done", sources: [] });
      const waiting = await queue(ana);

      const moved = await fixture.research.attachBatch(
        [inBatch.brief, ready.brief, waiting.brief],
        "batch_b",
      );

      expect(moved).toBe(0);
      expect(await row(inBatch.brief)).toMatchObject({ batch_id: "batch_a", attempts: 1 });
      expect(await row(ready.brief)).toMatchObject({ status: "ready", batch_id: null });
      expect(await row(waiting.brief)).toMatchObject({ status: "queued", batch_id: null });
    });

    it("lists each batch with briefs in flight once, and its briefs with their owners", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const a1 = await submitted(ana, "batch_a");
      const a2 = await submitted(ben, "batch_a");
      const b1 = await submitted(ana, "batch_b");
      await fixture.research.completeBrief(b1.brief, { body: "Done", sources: [] });
      await queue(ana);

      expect(await fixture.research.submittedBatchIds()).toEqual(["batch_a"]);
      expect(await fixture.research.briefsInBatch("batch_a")).toEqual([
        { id: a1.brief, userId: ana },
        { id: a2.brief, userId: ben },
      ]);
      expect(await fixture.research.briefsInBatch("batch_b")).toEqual([]);
      expect(await fixture.research.briefsInBatch("nothing")).toEqual([]);
    });
  });

  describe("completeBrief", () => {
    it.each(["submitted", "writing"] as const)(
      "makes a %s brief ready, with its body and sources",
      async (state) => {
        const ana = await fixture.createUser("ana");
        const queued = state === "submitted" ? await submitted(ana) : await writing(ana);
        fixture.advanceClock(HOUR);
        const sources = [{ url: "https://example.org/a", title: "A source" }];

        const done = await fixture.research.completeBrief(queued.brief, {
          body: "# Brief\n\nText [A source](https://example.org/a).",
          sources,
        });

        expect(done).toBe(true);
        expect(await fixture.research.getBrief(ana, queued.id)).toMatchObject({
          status: "ready",
          body: "# Brief\n\nText [A source](https://example.org/a).",
          sources,
          note: null,
          completedAt: formatIsoUtc(fixture.clock.now()),
        });
        expect(await row(queued.brief)).toMatchObject({ batch_id: null });
        expect(await fixture.research.submittedBatchIds()).toEqual([]);
      },
    );

    it("cuts a body that is too long, rather than failing", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await submitted(ana);

      await fixture.research.completeBrief(queued.brief, {
        body: "x".repeat(MAX_BRIEF_LENGTH + 500),
        sources: [],
      });

      expect((await fixture.research.getBrief(ana, queued.id))?.body).toHaveLength(
        MAX_BRIEF_LENGTH,
      );
    });

    it("ignores a brief that is not in flight", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await queue(ana);

      expect(
        await fixture.research.completeBrief(queued.brief, { body: "Late", sources: [] }),
      ).toBe(false);
      expect(
        await fixture.research.completeBrief(crypto.randomUUID(), { body: "x", sources: [] }),
      ).toBe(false);
      expect(await fixture.research.completeBrief("nope", { body: "x", sources: [] })).toBe(false);
      expect(await row(queued.brief)).toMatchObject({ status: "queued", body: null });
    });
  });

  describe("failBrief", () => {
    it("puts a failed brief back in the queue once, with a note", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await submitted(ana);
      fixture.advanceClock(HOUR);

      const result = await fixture.research.failBrief(queued.brief, "the batch expired");

      expect(result).toBe("queued");
      expect(await fixture.research.getBrief(ana, queued.id)).toMatchObject({
        status: "queued",
        note: "Retrying after the batch expired",
        completedAt: null,
        updatedAt: "2026-10-01T10:01:00.000Z",
      });
      expect(await row(queued.brief)).toMatchObject({ batch_id: null, attempts: 1 });
      expect(await fixture.research.submittedBatchIds()).toEqual([]);
    });

    it("drops a brief that fails on its second submission, with a note and a completion time", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await submitted(ana);
      await fixture.research.failBrief(queued.brief, "the batch expired");
      fixture.advanceClock(HOUR);
      expect(await sendBatch("batch_2")).toEqual([queued.brief]);
      expect(await row(queued.brief)).toMatchObject({ attempts: 2, note: null });
      fixture.advanceClock(HOUR);

      const result = await fixture.research.failBrief(queued.brief, "the batch expired");

      expect(result).toBe("dropped");
      expect(await fixture.research.getBrief(ana, queued.id)).toMatchObject({
        status: "dropped",
        note: "Dropped after 2 tries: the batch expired",
        completedAt: "2026-10-01T11:01:00.000Z",
      });
      expect(await row(queued.brief)).toMatchObject({ batch_id: null, attempts: 2 });
    });

    it("applies to a brief written on request too, and the retry waits for the next batch", async () => {
      const ana = await fixture.createUser("ana");
      const asked = await writing(ana);

      expect(await fixture.research.failBrief(asked.brief, "the model refused")).toBe("queued");

      expect(await sendBatch("batch_1")).toEqual([asked.brief]);
      expect(await fixture.research.failBrief(asked.brief, "the model refused")).toBe("dropped");
    });

    it("does nothing to a brief that is not in flight", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await queue(ana);
      const ready = await writing(ana);
      await fixture.research.completeBrief(ready.brief, { body: "Done", sources: [] });

      expect(await fixture.research.failBrief(queued.brief, "late")).toBeNull();
      expect(await fixture.research.failBrief(ready.brief, "late")).toBeNull();
      expect(await fixture.research.failBrief(crypto.randomUUID(), "late")).toBeNull();
      expect(await fixture.research.failBrief("nope", "late")).toBeNull();
      expect(await row(queued.brief)).toMatchObject({ status: "queued", note: null });
      expect(await row(ready.brief)).toMatchObject({ status: "ready", body: "Done" });
    });
  });

  describe("failStuckWriting", () => {
    it("fails the briefs that have been writing since before the cut-off, and only those", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const stuck = await writing(ana);
      const alsoStuck = await writing(ben);
      const inBatch = await submitted(ana);
      fixture.advanceClock(HOUR + MINUTE);
      const fresh = await writing(ben);
      const cutOff = subHours(fixture.clock.now(), 1);

      const failed = await fixture.research.failStuckWriting(cutOff);

      expect(failed).toBe(2);
      expect(await row(stuck.brief)).toMatchObject({
        status: "queued",
        note: "Retrying after the writer stopped partway",
      });
      expect(await row(alsoStuck.brief)).toMatchObject({ status: "queued" });
      expect(await row(inBatch.brief)).toMatchObject({ status: "submitted" });
      expect(await row(fresh.brief)).toMatchObject({ status: "writing", note: null });
    });

    it("drops a brief that was already on its second go", async () => {
      const ana = await fixture.createUser("ana");
      const stuck = await writing(ana);
      await fixture.research.failBrief(stuck.brief, "the model refused");
      expect(await sendBatch("batch_1")).toEqual([stuck.brief]);
      // Dropped after two submissions; a request by hand starts a third go, which then dies.
      await fixture.research.failBrief(stuck.brief, "the batch expired");
      expect(await row(stuck.brief)).toMatchObject({ status: "dropped" });
      await fixture.research.requestBriefNow(ana, stuck.id);
      fixture.advanceClock(2 * HOUR);

      await fixture.research.failStuckWriting(subHours(fixture.clock.now(), 1));

      expect(await row(stuck.brief)).toMatchObject({
        status: "dropped",
        note: "Dropped after 2 tries: the writer stopped partway",
        completed_at: fixture.clock.now(),
      });
    });
  });

  describe("failUnstartedBatch", () => {
    it("fails the briefs claimed before the cut-off that never got a batch, and only those", async () => {
      const ana = await fixture.createUser("ana");
      const lost = await queue(ana);
      await fixture.research.claimForBatch(fixture.clock.now());
      const attached = await submitted(ana, "batch_a");
      fixture.advanceClock(HOUR + MINUTE);
      const fresh = await queue(ana);
      await fixture.research.claimForBatch(fixture.clock.now());
      const cutOff = subHours(fixture.clock.now(), 1);

      const failed = await fixture.research.failUnstartedBatch(cutOff);

      expect(failed).toBe(1);
      expect(await row(lost.brief)).toMatchObject({
        status: "queued",
        note: "Retrying after the batch never started",
        attempts: 1,
      });
      expect(await row(attached.brief)).toMatchObject({ status: "submitted" });
      expect(await row(fresh.brief)).toMatchObject({ status: "submitted", note: null });
    });
  });

  describe("failUnfinishedBatch", () => {
    it("fails the briefs whose batch has been out since before the cut-off, and only those", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 10 });
      const old = await submitted(ana, "batch_old");
      const oldBen = await submitted(ben, "batch_old");
      fixture.advanceClock(3 * 24 * HOUR);
      const recent = await submitted(ana, "batch_new");
      const cutOff = subHours(fixture.clock.now(), 3 * 24);

      const failed = await fixture.research.failUnfinishedBatch(cutOff);

      expect(failed).toBe(2);
      for (const lost of [old, oldBen]) {
        expect(await row(lost.brief)).toMatchObject({
          status: "queued",
          batch_id: null,
          note: "Retrying after the batch never finished",
        });
      }
      expect(await row(recent.brief)).toMatchObject({ status: "submitted", batch_id: "batch_new" });
      expect(await fixture.research.submittedBatchIds()).toEqual(["batch_new"]);
    });
  });

  describe("claimWriter", () => {
    it("lets the first job take up a brief being written, and turns a second one away", async () => {
      const ana = await fixture.createUser("ana");
      const asked = await writing(ana);

      expect(await fixture.research.claimWriter(ana, asked.brief)).toBe(true);
      expect(await row(asked.brief)).toMatchObject({ writer_started_at: fixture.clock.now() });
      expect(await fixture.research.claimWriter(ana, asked.brief)).toBe(false);
    });

    it("lets exactly one of several jobs delivered at once take it", async () => {
      const ana = await fixture.createUser("ana");
      const asked = await writing(ana);

      const taken = await Promise.all(
        Array.from({ length: 5 }, () => fixture.research.claimWriter(ana, asked.brief)),
      );

      expect(taken.filter(Boolean)).toHaveLength(1);
    });

    it("lets the next writer in once the brief changes state", async () => {
      const ana = await fixture.createUser("ana");
      const asked = await writing(ana);
      await fixture.research.claimWriter(ana, asked.brief);

      // The job failed: the brief is queued, then asked for again.
      await fixture.research.failBrief(asked.brief, "the request failed");
      expect(await row(asked.brief)).toMatchObject({ writer_started_at: null });
      await fixture.research.requestBriefNow(ana, asked.id);
      expect(await fixture.research.claimWriter(ana, asked.brief)).toBe(true);

      // A job that lost its writer: the stuck brief is failed (its second go, so dropped) and can
      // be asked for again.
      fixture.advanceClock(2 * HOUR);
      await fixture.research.failStuckWriting(subHours(fixture.clock.now(), 1));
      expect(await row(asked.brief)).toMatchObject({ status: "dropped", writer_started_at: null });
      await fixture.research.requestBriefNow(ana, asked.id);
      expect(await fixture.research.claimWriter(ana, asked.brief)).toBe(true);
      await fixture.research.completeBrief(asked.brief, { body: "Done", sources: [] });
      expect(await row(asked.brief)).toMatchObject({ writer_started_at: null });
    });

    it("refuses a brief that isn't being written, another user's, and an id that isn't one", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const queued = await queue(ana);
      const asked = await writing(ana);

      expect(await fixture.research.claimWriter(ana, queued.brief)).toBe(false);
      expect(await fixture.research.claimWriter(ben, asked.brief)).toBe(false);
      expect(await fixture.research.claimWriter(ana, "nope")).toBe(false);
      expect(await row(asked.brief)).toMatchObject({ writer_started_at: null });
    });
  });

  describe("holdBrief", () => {
    it("puts a brief being written back in the queue without using up an attempt or a job", async () => {
      const ana = await fixture.createUser("ana");
      const asked = await writing(ana);

      const held = await fixture.research.holdBrief(
        asked.brief,
        "Held: today's spending cap was reached",
      );

      expect(held).toBe(true);
      expect(await fixture.research.getBrief(ana, asked.id)).toMatchObject({
        status: "queued",
        mode: "batch",
        note: "Held: today's spending cap was reached",
      });
      expect(await row(asked.brief)).toMatchObject({
        attempts: 0,
        submitted_at: null,
        writer_started_at: null,
      });
      expect(await submissionRows(asked.brief)).toEqual([]);
      expect(await fixture.research.submissionsToday(ana)).toBe(0);
    });

    it("puts a claimed brief back the same way, and only the held go's job comes back", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await queue(ana);
      await fixture.research.claimForBatch(fixture.clock.now());
      await fixture.research.failBrief(queued.brief, "the batch expired");
      fixture.advanceClock(MINUTE);
      await fixture.research.claimForBatch(fixture.clock.now());
      expect(await submissionRows(queued.brief)).toHaveLength(2);

      expect(await fixture.research.holdBrief(queued.brief, "Held")).toBe(true);

      expect(await row(queued.brief)).toMatchObject({ status: "queued", attempts: 1 });
      expect(await submissionRows(queued.brief)).toHaveLength(1);
      expect(await fixture.research.submissionsToday(ana)).toBe(1);
    });

    it("does nothing to a brief that is not in flight", async () => {
      const ana = await fixture.createUser("ana");
      const queued = await queue(ana);

      expect(await fixture.research.holdBrief(queued.brief, "Held")).toBe(false);
      expect(await row(queued.brief)).toMatchObject({ note: null });
    });

    it("keeps users apart: holdBriefFor puts back only the user's own brief", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const asked = await writing(ana);

      expect(await fixture.research.holdBriefFor(ben, asked.brief, "Held")).toBe(false);
      expect(await row(asked.brief)).toMatchObject({ status: "writing", attempts: 1 });
      expect(await fixture.research.submissionsToday(ana)).toBe(1);

      expect(await fixture.research.holdBriefFor(ana, asked.brief, "Couldn't start it")).toBe(true);
      expect(await row(asked.brief)).toMatchObject({
        status: "queued",
        note: "Couldn't start it",
        attempts: 0,
      });
      expect(await fixture.research.submissionsToday(ana)).toBe(0);
    });
  });

  describe("submissions", () => {
    it("are counted per user for the UTC day, whatever the brief's later fate", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const batched = await submitted(ana);
      await fixture.research.failBrief(batched.brief, "the batch expired");
      await writing(ben);

      expect(await fixture.research.submissionsToday(ana)).toBe(1);
      expect(await fixture.research.submissionsToday(ben)).toBe(1);
      expect(await fixture.research.submissionsToday("someone-else")).toBe(0);

      fixture.advanceClock(15 * HOUR);
      expect(await fixture.research.submissionsToday(ana)).toBe(0);
    });

    it("go with the brief and with the user", async () => {
      const ana = await fixture.createUser("ana");
      const first = await submitted(ana);
      const second = await writing(ana);

      await fixture.pool.query(`delete from clippings where id = $1`, [first.id]);
      expect(await submissionRows(first.brief)).toEqual([]);
      expect(await submissionRows(second.brief)).toHaveLength(1);

      await fixture.deleteUser(ana);
      expect(await submissionRows(second.brief)).toEqual([]);
    });
  });

  describe("getBriefForWriting", () => {
    it("loads one of the user's briefs for the writer, and no one else's", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const asked = await writing(ana);

      expect(await fixture.research.getBriefForWriting(ana, asked.brief)).toMatchObject({
        id: asked.brief,
        userId: ana,
        domain: "",
        reason: "Asked for by hand",
      });
      expect(await fixture.research.getBriefForWriting(ben, asked.brief)).toBeNull();
      expect(await fixture.research.getBriefForWriting(ana, "nope")).toBeNull();
    });

    it("is null once the clipping is deleted", async () => {
      const ana = await fixture.createUser("ana");
      const asked = await writing(ana);
      await fixture.service.deleteClipping(ana, asked.id);

      expect(await fixture.research.getBriefForWriting(ana, asked.brief)).toBeNull();
    });
  });

  it("is removed with the clipping when it is purged, and with the user", async () => {
    const ana = await fixture.createUser("ana");
    const queued = await queue(ana);

    await fixture.pool.query(`delete from clippings where id = $1`, [queued.id]);
    expect(await row(queued.brief)).toBeUndefined();

    const other = await queue(ana);
    await fixture.deleteUser(ana);
    expect(await row(other.brief)).toBeUndefined();
  });

  it("allows one brief per clipping, whatever writes it", async () => {
    const ana = await fixture.createUser("ana");
    const queued = await queue(ana);

    await expect(
      fixture.pool.query(
        `insert into research_briefs (user_id, clipping_id, domain, status, created_at, updated_at)
         values ($1, $2, 'x', 'queued', now(), now())`,
        [ana, queued.id],
      ),
    ).rejects.toThrow(/research_briefs_clipping_id_key/);
  });
});
