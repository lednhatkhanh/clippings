import { parseISO } from "date-fns";
import { describe, expect, it, vi } from "vitest";

import { handleDigestRequest } from "./digest-request.ts";

const NOW = parseISO("2026-10-01T05:00:00.000Z");

function setup(secret: string | undefined = "cron-secret", { fails = false } = {}) {
  const calls: { limit: number; deadline: Date }[] = [];
  const deps = {
    secret,
    clock: { now: () => NOW },
    digests: {
      generateWeeklyDigests: async (options: { limit: number; deadline: Date }) => {
        calls.push(options);
        if (fails) throw new Error("the database is unreachable");
        return 3;
      },
    },
  };
  return {
    calls,
    call: (authorization?: string) =>
      handleDigestRequest(
        new Request("https://clippings.example/api/cron/digest", {
          headers: authorization ? { authorization } : {},
        }),
        deps,
      ),
  };
}

describe("handleDigestRequest", () => {
  it("writes the digests with 20 users and the route's minute as the deadline", async () => {
    const { call, calls } = setup();

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ digests: 3 });
    expect(calls).toEqual([{ limit: 20, deadline: parseISO("2026-10-01T05:01:00.000Z") }]);
  });

  it("reports a failed run with a 500", async () => {
    const { call } = setup("cron-secret", { fails: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ digests: 0, digestsFailed: true });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("refuses a missing or wrong secret, and does nothing", async () => {
    const { call, calls } = setup();

    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("cron-secret")).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuses everyone when no secret is configured", async () => {
    const { call, calls } = setup(undefined);

    expect((await call("Bearer undefined")).status).toBe(401);
    expect(calls).toEqual([]);
  });
});
