import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUBLISH_TIMEOUT_MS, within } from "./job-publisher.ts";

describe("within", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives the answer when it comes in time", async () => {
    const answer = within(Promise.resolve("published"), PUBLISH_TIMEOUT_MS);

    await expect(answer).resolves.toBe("published");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes on a failure that comes in time", async () => {
    await expect(within(Promise.reject(new Error("401")), PUBLISH_TIMEOUT_MS)).rejects.toThrow(
      "401",
    );
  });

  it("gives up on a queue that doesn't answer, so the save isn't held", async () => {
    const answer = within(new Promise<string>(() => {}), PUBLISH_TIMEOUT_MS);
    const failure = expect(answer).rejects.toThrow(`didn't answer in ${PUBLISH_TIMEOUT_MS} ms`);

    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS);

    await failure;
  });
});
