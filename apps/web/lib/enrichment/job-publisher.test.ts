import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createJobPublisher, within } from "./job-publisher.ts";

const PUBLISH_TIMEOUT_MS = 3000;
const publishJSON = vi.fn();

vi.mock("@upstash/qstash", () => ({
  Client: class {
    publishJSON = publishJSON;
  },
}));

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

describe("requesting enrichment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("QSTASH_TOKEN", "token");
    vi.stubEnv("BETTER_AUTH_URL", "https://clippings.example");
    publishJSON.mockReset();
    // A queue that takes ten seconds to answer.
    publishJSON.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ messageId: "m" }), 10_000)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("waits for a slow queue when the caller set no bound", async () => {
    let done = false;
    const request = createJobPublisher()
      .requestEnrichment("c1")
      .then(() => {
        done = true;
      });

    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS + 1000);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    await request;
    expect(done).toBe(true);
  });

  it("gives up on a slow queue after the caller's bound", async () => {
    const request = expect(
      createJobPublisher().requestEnrichment("c1", { timeoutMs: PUBLISH_TIMEOUT_MS }),
    ).rejects.toThrow("didn't answer");

    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS);

    await request;
    expect(publishJSON).toHaveBeenCalledOnce();
  });
});
