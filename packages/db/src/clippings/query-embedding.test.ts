import { describe, expect, it } from "vitest";

import { isWorthEmbedding } from "./query-embedding.ts";

describe("isWorthEmbedding", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["re", false],
    ["rea", false],
    ["r e a", false],
    ["reac", true],
    ["react hooks", true],
    ["  a b c d  ", true],
    ["机器学习", true],
    ["机器学", false],
  ])("%j -> %s", (query, expected) => {
    expect(isWorthEmbedding(query)).toBe(expected);
  });
});
