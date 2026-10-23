import { describe, expect, it } from "vitest";

import { POLL_FIRST_MS, POLL_MAX_MS, pollDelay } from "./poll-schedule.ts";

describe("pollDelay", () => {
  it.each([
    { name: "the first ask", attempt: 0, expected: POLL_FIRST_MS },
    { name: "doubles", attempt: 1, expected: 4000 },
    { name: "doubles again", attempt: 2, expected: 8000 },
    { name: "keeps doubling", attempt: 4, expected: 32_000 },
    { name: "stops at the cap", attempt: 5, expected: POLL_MAX_MS },
    { name: "stays at the cap", attempt: 500, expected: POLL_MAX_MS },
    { name: "a negative count starts over", attempt: -3, expected: POLL_FIRST_MS },
    { name: "not a number starts over", attempt: Number.NaN, expected: POLL_FIRST_MS },
  ])("$name", ({ attempt, expected }) => {
    expect(pollDelay(attempt)).toBe(expected);
  });
});
