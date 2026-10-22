import { describe, expect, it, vi } from "vitest";

import { handleSweepRequest } from "./sweep-request.ts";

function setup(
  secret: string | undefined = "cron-secret",
  { drainFails = false, digestsFail = false } = {},
) {
  const swept = ["a", "b"];
  let calls = 0;
  let purges = 0;
  let embeds = 0;
  let drains = 0;
  const digestLimits: number[] = [];
  const deps = {
    secret,
    service: {
      sweepStuck: async () => {
        calls += 1;
        return swept;
      },
      purgeDeleted: async () => {
        purges += 1;
        return 3;
      },
      drainImports: async () => {
        drains += 1;
        if (drainFails) throw new Error("the queue is unreachable");
        return ["i", "j", "k", "l", "m"];
      },
      embedMissing: async () => {
        embeds += 1;
        return 4;
      },
    },
    digests: {
      generateWeeklyDigests: async ({ limit }: { limit: number }) => {
        digestLimits.push(limit);
        if (digestsFail) throw new Error("the database is unreachable");
        return 2;
      },
    },
  };
  return {
    calls: () => calls,
    purges: () => purges,
    embeds: () => embeds,
    drains: () => drains,
    digestLimits: () => digestLimits,
    call: (authorization?: string) =>
      handleSweepRequest(
        new Request("https://clippings.example/api/cron/sweep", {
          headers: authorization ? { authorization } : {},
        }),
        deps,
      ),
  };
}

describe("handleSweepRequest", () => {
  it("sweeps, embeds, drains imports and purges when the cron secret is presented", async () => {
    const { call, calls, purges, embeds, drains, digestLimits } = setup();

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requested: 2,
      embedded: 4,
      imports: 5,
      purged: 3,
      digests: 2,
    });
    expect(digestLimits()).toEqual([10]);
    expect(calls()).toBe(1);
    expect(embeds()).toBe(1);
    expect(drains()).toBe(1);
    expect(purges()).toBe(1);
  });

  it("still purges when the import drain fails, and says so", async () => {
    const { call, purges, embeds, drains } = setup("cron-secret", { drainFails: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requested: 2,
      embedded: 4,
      imports: 0,
      importsFailed: true,
      purged: 3,
      digests: 2,
    });
    expect(embeds()).toBe(1);
    expect(drains()).toBe(1);
    expect(purges()).toBe(1);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("reports a failed digest run and keeps the rest of the sweep", async () => {
    const { call, purges } = setup("cron-secret", { digestsFail: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requested: 2,
      embedded: 4,
      imports: 5,
      purged: 3,
      digests: 0,
      digestsFailed: true,
    });
    expect(purges()).toBe(1);
    logged.mockRestore();
  });

  it("refuses a missing or wrong secret", async () => {
    const { call, calls, purges, embeds, drains, digestLimits } = setup();

    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("cron-secret")).status).toBe(401);
    expect(calls()).toBe(0);
    expect(embeds()).toBe(0);
    expect(drains()).toBe(0);
    expect(purges()).toBe(0);
    expect(digestLimits()).toEqual([]);
  });

  it("refuses everyone when no secret is configured", async () => {
    const { call, calls } = setup(undefined);

    expect((await call("Bearer undefined")).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect(calls()).toBe(0);
  });
});
