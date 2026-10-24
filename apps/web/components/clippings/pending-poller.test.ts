import { describe, expect, it } from "vitest";

import type { ClippingRowData } from "@/lib/clippings/rows.ts";
import { MAX_STATUS_IDS, type ClippingSource, type ClippingStatus } from "@clippings/shared";

import { createPendingPoller } from "./pending-poller.ts";

/** Lets the promises a timer started settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  let canPoll = true;
  /** What the server says each clipping's status is; one not in it is gone. */
  const statuses = new Map<string, ClippingStatus>();
  const requests: { at: number; ids: string[] }[] = [];
  const rowReads: string[] = [];
  let statusRequestFails = false;

  const poller = createPendingPoller({
    fetchStatuses: async (ids) => {
      requests.push({ at: now, ids });
      if (statusRequestFails) throw new Error("offline");
      return ids.flatMap((id) => {
        const status = statuses.get(id);
        return status ? [{ id, status }] : [];
      });
    },
    fetchRow: async (id) => {
      rowReads.push(id);
      return { id, status: statuses.get(id) } as ClippingRowData;
    },
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
    canPoll: () => canPoll,
  });

  /** Runs the clock forward, firing each timer that falls due on the way. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const [id, next] =
        [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0] ??
        [];
      if (id === undefined || !next) break;
      timers.delete(id);
      now = Math.max(now, next.at);
      next.run();
      await settle();
    }
    now = end;
  }

  const delivered: ClippingRowData[] = [];
  const watch = (id: string, source: ClippingSource = "web") =>
    poller.watch(id, source, (row) => delivered.push(row));

  return {
    poller,
    watch,
    advance,
    statuses,
    requests,
    rowReads,
    delivered,
    setCanPoll: (value: boolean) => {
      canPoll = value;
    },
    failStatusRequests: (value: boolean) => {
      statusRequestFails = value;
    },
    /** The waits between one request and the next. */
    gaps: () => requests.slice(1).map(({ at }, index) => at - requests[index]!.at),
  };
}

describe("createPendingPoller", () => {
  it("asks about the rows that start together in one request", async () => {
    const { watch, advance, statuses, requests } = setup();
    for (const id of ["a", "b", "c"]) {
      statuses.set(id, "pending");
      watch(id);
    }

    await advance(0);

    expect(requests).toEqual([{ at: 0, ids: ["a", "b", "c"] }]);
  });

  it("gives a row that has finished to its owner, read once, and asks no more about it", async () => {
    const { watch, advance, statuses, requests, rowReads, delivered } = setup();
    statuses.set("a", "pending");
    statuses.set("b", "pending");
    watch("a");
    watch("b");
    await advance(0);

    statuses.set("a", "ready");
    await advance(2000);

    expect(rowReads).toEqual(["a"]);
    expect(delivered.map(({ id }) => id)).toEqual(["a"]);
    await advance(4000);
    expect(requests.at(-1)?.ids).toEqual(["b"]);
    expect(requests.map(({ ids }) => ids)).toEqual([["a", "b"], ["a", "b"], ["b"]]);
  });

  it("hands over a row that failed too, so the list can offer Retry", async () => {
    const { watch, advance, statuses, delivered } = setup();
    statuses.set("a", "failed");
    watch("a");

    await advance(0);

    expect(delivered.map(({ id }) => id)).toEqual(["a"]);
  });

  it("waits twice as long after each answer that says pending, up to a minute", async () => {
    const { watch, advance, statuses, gaps } = setup();
    statuses.set("a", "pending");
    watch("a");

    await advance(600_000);

    expect(gaps().slice(0, 8)).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("waits up to five minutes for an imported row", async () => {
    const { watch, advance, statuses, gaps } = setup();
    statuses.set("a", "pending");
    watch("a", "import");

    await advance(1_800_000);

    expect(gaps().slice(0, 9)).toEqual([
      2000, 4000, 8000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000,
    ]);
  });

  it("asks about a row only when it is due, in a request shared with the rows due at the same time", async () => {
    const { watch, advance, statuses, requests } = setup();
    statuses.set("early", "pending");
    statuses.set("late", "pending");
    watch("early");
    await advance(0);
    await advance(1000);
    watch("late");
    await advance(1000);

    // `early` is next due at 2 s (its first wait), `late` at once: a request of its own at 1 s.
    expect(requests).toEqual([
      { at: 0, ids: ["early"] },
      { at: 1000, ids: ["late"] },
      { at: 2000, ids: ["early"] },
    ]);
  });

  it("splits a long list of rows into requests of at most MAX_STATUS_IDS", async () => {
    const { watch, advance, statuses, requests } = setup();
    const ids = Array.from({ length: MAX_STATUS_IDS * 2 + 5 }, (_, n) => `row-${n}`);
    for (const id of ids) {
      statuses.set(id, "pending");
      watch(id);
    }

    await advance(0);

    expect(requests.map(({ ids: asked }) => asked.length)).toEqual([
      MAX_STATUS_IDS,
      MAX_STATUS_IDS,
      5,
    ]);
    expect(requests.flatMap(({ ids: asked }) => asked)).toEqual(ids);
  });

  it("stops asking about a row that is no longer watched, and sets no timer once none is", async () => {
    const { watch, advance, statuses, requests } = setup();
    statuses.set("a", "pending");
    const stop = watch("a");
    await advance(0);

    stop();
    await advance(600_000);

    expect(requests).toHaveLength(1);
  });

  it("keeps a row's waits from where they were when it is watched again", async () => {
    const { watch, advance, statuses, requests } = setup();
    statuses.set("a", "pending");
    const stop = watch("a");
    await advance(2000);
    await advance(4000);
    stop();
    expect(requests).toHaveLength(3);

    watch("a");
    await advance(0);
    await advance(16_000);

    // Back on screen it asks at once, then waits 16 s, the next in its doubling, not 2 s again.
    expect(requests.slice(3).map(({ at }) => at)).toEqual([6000, 22_000]);
  });

  it("drops a row the server no longer has", async () => {
    const { watch, advance, requests, delivered } = setup();
    watch("gone");

    await advance(600_000);

    expect(requests).toHaveLength(1);
    expect(delivered).toEqual([]);
  });

  it("backs off like a pending answer when a request fails, then carries on", async () => {
    const { watch, advance, statuses, requests, failStatusRequests, delivered } = setup();
    statuses.set("a", "pending");
    failStatusRequests(true);
    watch("a");
    await advance(0);

    failStatusRequests(false);
    statuses.set("a", "ready");
    await advance(2000);

    expect(requests.map(({ at }) => at)).toEqual([0, 2000]);
    expect(delivered.map(({ id }) => id)).toEqual(["a"]);
  });

  it("asks nothing while it can't poll, and resumes when woken", async () => {
    const { poller, watch, advance, statuses, requests, setCanPoll } = setup();
    statuses.set("a", "pending");
    setCanPoll(false);
    watch("a");

    await advance(60_000);
    expect(requests).toEqual([]);

    setCanPoll(true);
    poller.wake();
    await advance(0);
    expect(requests).toEqual([{ at: 60_000, ids: ["a"] }]);
  });
});
