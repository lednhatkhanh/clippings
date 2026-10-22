import { differenceInMilliseconds, parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { lastFinishedWeek } from "./service.ts";

describe("lastFinishedWeek", () => {
  it.each([
    ["2026-10-01T09:00:00.000Z", "2026-09-21"],
    ["2026-09-28T00:00:00.000Z", "2026-09-21"],
    ["2026-09-27T23:59:59.999Z", "2026-09-14"],
    ["2026-10-04T23:59:59.999Z", "2026-09-21"],
    ["2026-10-05T00:00:00.000Z", "2026-09-28"],
    ["2027-01-01T12:00:00.000Z", "2026-12-21"],
  ])("at %s the last finished week starts on %s", (now, expected) => {
    expect(lastFinishedWeek(parseISO(now))).toBe(expected);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("the weekly digest", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  // The fixture's clock starts on Thursday 2026-10-01 09:00 UTC, so the last finished week is
  // Monday 2026-09-21 to Sunday 2026-09-27.
  const WEEK = "2026-09-21";
  const IN_WEEK = "2026-09-23T10:00:00.000Z";

  /** Saves and reads a page, then backdates the clipping to when it "was saved". */
  async function save(
    userId: string,
    slug: string,
    savedAt: string,
    options: { text?: string; note?: string; tags?: string[] } = {},
  ) {
    const url = `https://example.com/${slug}`;
    const text = options.text ?? `Words about ${slug}`;
    fixture.web.set(url, {
      page: { title: slug, text },
      summary: { title: `Title of ${slug}`, summary: `Summary of ${slug}.`, excerpt: text },
    });
    const { clipping } = await fixture.service.saveClipping(userId, {
      url,
      source: "web",
      note: options.note,
      tags: options.tags,
    });
    await fixture.service.enrichClipping(clipping.id);
    await fixture.pool.query(`update clippings set created_at = $1 where id = $2`, [
      savedAt,
      clipping.id,
    ]);
    return clipping.id;
  }

  /** Moves the clock to a Monday just after the week in `lastFinishedWeek`. */
  function advanceTo(iso: string) {
    fixture.advanceClock(
      differenceInMilliseconds(parseISO(iso), parseISO("2026-10-01T09:00:00.000Z")),
    );
  }

  it("writes the digest of the last finished week from that week's clippings only", async () => {
    const ana = await fixture.createUser("ana");
    const inside = await save(ana, "inside", IN_WEEK, {
      note: "Worth rereading",
      tags: ["reading"],
    });
    await save(ana, "before", "2026-09-20T23:59:59.000Z");
    await save(ana, "after", "2026-09-28T00:00:00.000Z");

    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(1);

    expect(fixture.digested).toEqual([
      {
        weekStart: WEEK,
        clippings: [
          {
            id: inside,
            title: "Title of inside",
            summary: "Summary of inside.",
            tags: ["reading"],
            note: "Worth rereading",
          },
        ],
        related: [],
      },
    ]);
    expect(await fixture.digests.getDigest(ana)).toEqual({
      weekStart: WEEK,
      weekEnd: "2026-09-27",
      groups: [
        {
          title: "The week",
          summary: "1 clippings.",
          clippings: [{ id: inside, url: "https://example.com/inside", title: "Title of inside" }],
        },
      ],
      resurfaced: [],
    });
  });

  it("covers Monday 00:00 to Sunday 23:59:59 UTC", async () => {
    const ana = await fixture.createUser("ana");
    const first = await save(ana, "monday", "2026-09-21T00:00:00.000Z");
    const last = await save(ana, "sunday", "2026-09-27T23:59:59.999Z");
    await save(ana, "next-monday", "2026-09-28T00:00:00.000Z");

    await fixture.digests.generateWeeklyDigests({ limit: 10 });

    expect(fixture.digested[0]!.clippings.map(({ id }) => id)).toEqual([last, first]);
  });

  it("does not write a digest of the week that is still going", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "this-week", "2026-09-29T10:00:00.000Z");

    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(0);

    expect(fixture.digested).toEqual([]);
    expect(await fixture.digests.getDigest(ana)).toBeNull();
  });

  it("moves on to the next week when the clock passes Sunday", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "this-week", "2026-09-29T10:00:00.000Z");
    advanceTo("2026-10-05T00:00:00.000Z");

    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(1);

    expect(fixture.digested[0]!.weekStart).toBe("2026-09-28");
    expect(await fixture.digests.listDigestWeeks(ana)).toEqual([
      { weekStart: "2026-09-28", weekEnd: "2026-10-04" },
    ]);
  });

  it("writes each week's digest once: a second run does nothing", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "one", IN_WEEK);

    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(1);
    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(0);

    expect(fixture.digested).toHaveLength(1);
    const { rows } = await fixture.pool.query(`select 1 from weekly_digests`);
    expect(rows).toHaveLength(1);
  });

  it("skips users with no live clipping in the week", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    const cy = await fixture.createUser("cy");
    await save(ana, "ana-other-week", "2026-09-10T10:00:00.000Z");
    const gone = await save(bob, "bob-deleted", IN_WEEK);
    await fixture.service.deleteClipping(bob, gone);
    const kept = await save(cy, "cy-kept", IN_WEEK);

    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(1);

    expect(fixture.digested.map((call) => call.clippings.map(({ id }) => id))).toEqual([[kept]]);
    expect(await fixture.digests.getDigest(ana)).toBeNull();
    expect(await fixture.digests.getDigest(bob)).toBeNull();
  });

  it("leaves deleted clippings out of what the digester reads", async () => {
    const ana = await fixture.createUser("ana");
    const kept = await save(ana, "kept", IN_WEEK);
    const gone = await save(ana, "gone", "2026-09-24T10:00:00.000Z");
    await fixture.service.deleteClipping(ana, gone);

    await fixture.digests.generateWeeklyDigests({ limit: 10 });

    expect(fixture.digested[0]!.clippings.map(({ id }) => id)).toEqual([kept]);
  });

  it("keeps users apart", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    const anas = await save(ana, "anas", IN_WEEK, { tags: ["private"] });
    const bobs = await save(bob, "bobs", "2026-09-25T10:00:00.000Z");

    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(2);

    const seen = fixture.digested.map((call) => call.clippings.map(({ id }) => id));
    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual([anas]);
    expect(seen).toContainEqual([bobs]);
    const anaView = await fixture.digests.getDigest(ana);
    const bobView = await fixture.digests.getDigest(bob);
    expect(anaView!.groups[0]!.clippings.map(({ id }) => id)).toEqual([anas]);
    expect(bobView!.groups[0]!.clippings.map(({ id }) => id)).toEqual([bobs]);
    expect(await fixture.digests.getDigest(bob, WEEK)).toEqual(bobView);
    expect(await fixture.digests.listDigestWeeks(ana)).toEqual([
      { weekStart: WEEK, weekEnd: "2026-09-27" },
    ]);
    expect(await fixture.digests.listDigestWeeks(bob)).toHaveLength(1);

    // The other user's data stays out of a user's own digest even when the id turns up in it.
    await fixture.pool.query(
      `update weekly_digests set digest = jsonb_set(digest, '{resurfaced}', $1::jsonb) where user_id = $2`,
      [JSON.stringify([{ clippingId: bobs, why: "Not yours." }]), ana],
    );
    expect((await fixture.digests.getDigest(ana))!.resurfaced).toEqual([]);
  });

  it("writes at most `limit` digests a run and the rest on the next", async () => {
    for (const name of ["ana", "bob", "cy"]) {
      await save(await fixture.createUser(name), `page-${name}`, IN_WEEK);
    }

    expect(await fixture.digests.generateWeeklyDigests({ limit: 2 })).toBe(2);
    expect(await fixture.digests.generateWeeklyDigests({ limit: 2 })).toBe(1);
    expect(await fixture.digests.generateWeeklyDigests({ limit: 2 })).toBe(0);

    expect(fixture.digested).toHaveLength(3);
  });

  it("goes on with the other users when one user's digest fails, and retries that user", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    const broken = await save(ana, "anas", IN_WEEK);
    await save(bob, "bobs", IN_WEEK);
    fixture.failDigestsWith(broken);

    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(1);
    expect(await fixture.digests.getDigest(ana)).toBeNull();
    expect(await fixture.digests.getDigest(bob)).not.toBeNull();

    // The model comes back: the next run writes the digest that is missing and no other.
    fixture.digested.length = 0;
    fixture.healDigester();
    expect(await fixture.digests.generateWeeklyDigests({ limit: 10 })).toBe(1);
    expect(fixture.digested.map((call) => call.clippings.map(({ id }) => id))).toEqual([[broken]]);
    expect(await fixture.digests.getDigest(ana)).not.toBeNull();
  });

  it("offers older clippings close in meaning to the week's, never the week's own", async () => {
    const ana = await fixture.createUser("ana");
    fixture.meanings.set("garden", "plants");
    fixture.meanings.set("soil", "plants");
    const older = await save(ana, "older-garden", "2026-08-01T10:00:00.000Z", {
      text: "garden soil",
    });
    await save(ana, "unrelated", "2026-08-02T10:00:00.000Z", { text: "taxes" });
    const first = await save(ana, "week-garden", IN_WEEK, { text: "garden soil" });
    const second = await save(ana, "week-soil", "2026-09-24T10:00:00.000Z", { text: "soil" });
    // Saved after the week: close in meaning, but not "from your archive".
    await save(ana, "newer-garden", "2026-09-29T10:00:00.000Z", { text: "garden" });

    await fixture.digests.generateWeeklyDigests({ limit: 10 });

    const input = fixture.digested[0]!;
    expect(input.clippings.map(({ id }) => id)).toEqual([second, first]);
    expect(input.related.map(({ id }) => id)).toEqual([older]);
    expect((await fixture.digests.getDigest(ana))!.resurfaced).toEqual([
      {
        clipping: {
          id: older,
          url: "https://example.com/older-garden",
          title: "Title of older-garden",
        },
        why: "It fits this week.",
      },
    ]);
  });

  it("shows clippings under their current titles and leaves deleted ones out", async () => {
    const ana = await fixture.createUser("ana");
    const renamed = await save(ana, "renamed", IN_WEEK);
    const deleted = await save(ana, "deleted", "2026-09-24T10:00:00.000Z");
    await fixture.digests.generateWeeklyDigests({ limit: 10 });

    await fixture.service.updateClipping(ana, renamed, { title: "My own title" });
    await fixture.service.deleteClipping(ana, deleted);

    const view = await fixture.digests.getDigest(ana);
    expect(view!.groups[0]!.clippings.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: renamed, title: "My own title" },
    ]);

    await fixture.service.deleteClipping(ana, renamed);
    expect((await fixture.digests.getDigest(ana))!.groups).toEqual([]);
  });

  it("reads the latest week by default, any of the user's weeks by date, and nothing for a bad date", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "week-one", IN_WEEK);
    await fixture.digests.generateWeeklyDigests({ limit: 10 });
    await save(ana, "week-two", "2026-09-30T10:00:00.000Z");
    advanceTo("2026-10-05T00:00:00.000Z");
    await fixture.digests.generateWeeklyDigests({ limit: 10 });

    expect((await fixture.digests.listDigestWeeks(ana)).map((week) => week.weekStart)).toEqual([
      "2026-09-28",
      "2026-09-21",
    ]);
    expect((await fixture.digests.getDigest(ana))!.weekStart).toBe("2026-09-28");
    expect((await fixture.digests.getDigest(ana, "2026-09-21"))!.weekStart).toBe("2026-09-21");
    expect(await fixture.digests.getDigest(ana, "2026-09-14")).toBeNull();
    expect(await fixture.digests.getDigest(ana, "2026-02-30")).toBeNull();
    expect(await fixture.digests.getDigest(ana, "last week")).toBeNull();
  });

  it("goes away with the user", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "one", IN_WEEK);
    await fixture.digests.generateWeeklyDigests({ limit: 10 });

    await fixture.deleteUser(ana);

    const { rows } = await fixture.pool.query(`select 1 from weekly_digests`);
    expect(rows).toHaveLength(0);
  });
});
