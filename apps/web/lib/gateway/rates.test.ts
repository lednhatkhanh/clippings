import { describe, expect, it } from "vitest";

import {
  claudeCostMicros,
  UnknownModelError,
  voyageCostMicros,
  type ClaudeUsage,
} from "./rates.ts";

const usage = (overrides: Partial<ClaudeUsage>): ClaudeUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
  ...overrides,
});

const M = 1_000_000;

describe("claudeCostMicros", () => {
  it.each([
    // [what, model, usage, batch, micro-dollars]
    ["Haiku input is $0.10 per MTok", "claude-haiku-5-5", { inputTokens: 100_000 }, false, 10_000],
    [
      "Haiku output is $0.50 per MTok",
      "claude-haiku-5-5",
      { outputTokens: 100_000 },
      false,
      50_000,
    ],
    [
      "Haiku at exactly 100K prompt tokens is still the low band",
      "claude-haiku-5-5",
      { inputTokens: 100_000 },
      false,
      10_000,
    ],
    [
      "Haiku one token above 100K is the high band for the whole prompt (rounded up)",
      "claude-haiku-5-5",
      { inputTokens: 100_001 },
      false,
      50_001,
    ],
    [
      "Haiku's high band prices output at $2.50 too",
      "claude-haiku-5-5",
      { inputTokens: 150_000, outputTokens: 1_000 },
      false,
      77_500,
    ],
    [
      "Haiku prompt length counts cache reads (100K of them is still low)",
      "claude-haiku-5-5",
      { cacheReadTokens: 100_000 },
      false,
      1_000,
    ],
    [
      "Haiku prompt length counts cache reads (one more tips it high)",
      "claude-haiku-5-5",
      { cacheReadTokens: 100_001 },
      false,
      5_001,
    ],
    [
      "Haiku prompt length counts input, reads and writes together",
      "claude-haiku-5-5",
      { inputTokens: 40_000, cacheReadTokens: 40_000, cacheWriteTokens: 20_001 },
      false,
      // 40,000 x 0.50 + 40,000 x 0.05 + 20,001 x 0.625, per MTok, in micro-dollars.
      Math.ceil((40_000 * 500_000 + 4_000 * 500_000 + 20_001 * 625_000) / M),
    ],
    [
      "Sonnet is $2 in and $10 out",
      "claude-sonnet-5-5",
      { inputTokens: M, outputTokens: M },
      false,
      12_000_000,
    ],
    [
      "cache reads cost a tenth of input",
      "claude-sonnet-5-5",
      { cacheReadTokens: M },
      false,
      200_000,
    ],
    [
      "a 5-minute cache write costs 1.25 times input",
      "claude-sonnet-5-5",
      { cacheWriteTokens: M },
      false,
      2_500_000,
    ],
    [
      "a 1-hour cache write costs twice input",
      "claude-sonnet-5-5",
      { cacheWriteTokens: M, cacheWrite1hTokens: M },
      false,
      4_000_000,
    ],
    [
      "a cache write split between lifetimes",
      "claude-sonnet-5-5",
      { cacheWriteTokens: M, cacheWrite1hTokens: 400_000 },
      false,
      3_100_000,
    ],
    [
      "batch halves the tokens",
      "claude-sonnet-5-5",
      { inputTokens: M, outputTokens: M },
      true,
      6_000_000,
    ],
    [
      "batch halves cache pricing too",
      "claude-sonnet-5-5",
      { cacheWriteTokens: M },
      true,
      1_250_000,
    ],
    ["a web search is $0.01", "claude-sonnet-5-5", { webSearches: 1 }, false, 10_000],
    [
      "batch does not discount web searches",
      "claude-sonnet-5-5",
      { inputTokens: M, outputTokens: M, webSearches: 5 },
      true,
      6_000_000 + 50_000,
    ],
    [
      "all of it at once",
      "claude-sonnet-5-5",
      {
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 2_000,
        cacheWriteTokens: 400,
        webSearches: 2,
      },
      false,
      // 1,000 x 2 + 2,000 x 0.2 + 400 x 2.5 + 500 x 10 = 8,400 micro-dollars, plus 2 searches.
      28_400,
    ],
    ["an empty call is free", "claude-haiku-5-5", {}, false, 0],
    [
      "a single token still rounds up to a micro-dollar",
      "claude-haiku-5-5",
      { inputTokens: 1 },
      false,
      1,
    ],
  ] as const)("%s", (_what, model, tokens, batch, expected) => {
    expect(claudeCostMicros(model, usage(tokens), { batch })).toBe(expected);
  });

  it("refuses a model with no rate instead of pricing it at zero", () => {
    expect(() => claudeCostMicros("claude-mystery-9", usage({ inputTokens: 1 }))).toThrow(
      UnknownModelError,
    );
    expect(() => claudeCostMicros("constructor", usage({ inputTokens: 1 }))).toThrow(
      UnknownModelError,
    );
  });
});

describe("voyageCostMicros", () => {
  it.each([
    [M, 60_000],
    [100, 6],
    [1, 1],
    [0, 0],
  ])("%i tokens of voyage-4 cost %i micro-dollars", (tokens, expected) => {
    expect(voyageCostMicros("voyage-4", tokens)).toBe(expected);
  });

  it("refuses a model with no rate", () => {
    expect(() => voyageCostMicros("voyage-9", 1)).toThrow(UnknownModelError);
  });
});
