import { describe, expect, it, vi } from "vitest";

import { handleSweepRequest } from "./sweep-request.ts";

function setup(
  secret: string | undefined = "cron-secret",
  { drainFails = false, linksFail = false } = {},
) {
  const swept = ["a", "b"];
  let calls = 0;
  let purges = 0;
  let embeds = 0;
  let drains = 0;
  const linkLimits: number[] = [];
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
      checkLinks: async ({ limit }: { limit: number }) => {
        linkLimits.push(limit);
        if (linksFail) throw new Error("the database is unreachable");
        return { checked: 7, dead: 2 };
      },
    },
  };
  return {
    calls: () => calls,
    purges: () => purges,
    embeds: () => embeds,
    drains: () => drains,
    linkLimits: () => linkLimits,
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
  it("sweeps, embeds, drains imports, purges and checks links when the cron secret is presented", async () => {
    const { call, calls, purges, embeds, drains, linkLimits } = setup();

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requested: 2,
      embedded: 4,
      imports: 5,
      purged: 3,
      linksChecked: 7,
      linksDead: 2,
    });
    expect(calls()).toBe(1);
    expect(embeds()).toBe(1);
    expect(drains()).toBe(1);
    expect(purges()).toBe(1);
    expect(linkLimits()).toEqual([20]);
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
      linksChecked: 7,
      linksDead: 2,
    });
    expect(embeds()).toBe(1);
    expect(drains()).toBe(1);
    expect(purges()).toBe(1);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("still answers when the link check fails, and says so", async () => {
    const { call, purges } = setup("cron-secret", { linksFail: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      purged: 3,
      linksChecked: 0,
      linksDead: 0,
      linksFailed: true,
    });
    expect(purges()).toBe(1);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("refuses a missing or wrong secret", async () => {
    const { call, calls, purges, embeds, drains, linkLimits } = setup();

    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("cron-secret")).status).toBe(401);
    expect(calls()).toBe(0);
    expect(embeds()).toBe(0);
    expect(drains()).toBe(0);
    expect(purges()).toBe(0);
    expect(linkLimits()).toEqual([]);
  });

  it("refuses everyone when no secret is configured", async () => {
    const { call, calls } = setup(undefined);

    expect((await call("Bearer undefined")).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect(calls()).toBe(0);
  });
});
