import { describe, expect, it } from "vitest";

import { handleSweepRequest } from "./sweep-request";

function setup(secret: string | undefined = "cron-secret") {
  const swept = ["a", "b"];
  let calls = 0;
  const deps = {
    secret,
    service: {
      sweepStuck: async () => {
        calls += 1;
        return swept;
      },
    },
  };
  return {
    calls: () => calls,
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
  it("sweeps when the cron secret is presented", async () => {
    const { call, calls } = setup();

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requested: 2 });
    expect(calls()).toBe(1);
  });

  it("refuses a missing or wrong secret", async () => {
    const { call, calls } = setup();

    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("cron-secret")).status).toBe(401);
    expect(calls()).toBe(0);
  });

  it("refuses everyone when no secret is configured", async () => {
    const { call, calls } = setup(undefined);

    expect((await call("Bearer undefined")).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect(calls()).toBe(0);
  });
});
