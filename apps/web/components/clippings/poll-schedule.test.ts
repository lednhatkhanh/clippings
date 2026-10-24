import { describe, expect, it } from "vitest";

import {
  POLL_FIRST_MS,
  POLL_MAX_IMPORT_MS,
  POLL_MAX_MS,
  pollDelay,
  pollMax,
} from "./poll-schedule.ts";

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

  it.each([
    { name: "doubles as before", attempt: 5, expected: 64_000 },
    { name: "keeps doubling", attempt: 6, expected: 128_000 },
    { name: "doubles on", attempt: 7, expected: 256_000 },
    { name: "stops at the import cap", attempt: 8, expected: POLL_MAX_IMPORT_MS },
    { name: "stays at the import cap", attempt: 500, expected: POLL_MAX_IMPORT_MS },
  ])("an imported clipping $name", ({ attempt, expected }) => {
    expect(pollDelay(attempt, pollMax("import"))).toBe(expected);
  });
});

describe("pollMax", () => {
  it.each([
    { source: "web", expected: POLL_MAX_MS },
    { source: "extension", expected: POLL_MAX_MS },
    { source: "mcp", expected: POLL_MAX_MS },
    { source: "digest", expected: POLL_MAX_MS },
    { source: "import", expected: POLL_MAX_IMPORT_MS },
  ] as const)("$source", ({ source, expected }) => {
    expect(pollMax(source)).toBe(expected);
  });
});
