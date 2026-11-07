import { describe, expect, it } from "vitest";

import { dollarsFieldValue, formatDollars, parseCount, parseDollars } from "./automation.ts";

describe("parseDollars", () => {
  it.each([
    ["3", 3_000_000],
    ["$3", 3_000_000],
    ["  3.50 ", 3_500_000],
    ["0.1", 100_000],
    ["0.005", 5_000],
    ["0.000001", 1],
    ["0", 0],
    ["1000", 1_000_000_000],
    ["$ 2.25", 2_250_000],
  ])("reads %j as %i micro-dollars", (input, expected) => {
    expect(parseDollars(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "abc",
    "-1",
    "+1",
    "1,000",
    "1.2.3",
    "0.0000001",
    ".5",
    "5.",
    "1e3",
    "3 dollars",
    "99999999",
  ])("refuses %j", (input) => {
    expect(parseDollars(input)).toBeNull();
  });
});

describe("parseCount", () => {
  it.each([
    ["3", 3],
    [" 10 ", 10],
    ["0", 0],
  ])("reads %j as %i", (input, expected) => {
    expect(parseCount(input)).toBe(expected);
  });

  it.each(["", "-1", "1.5", "three", "1e2", "1234567"])("refuses %j", (input) => {
    expect(parseCount(input)).toBeNull();
  });
});

describe("formatDollars", () => {
  it.each([
    [0, "$0.00"],
    [3_000_000, "$3.00"],
    [420_000, "$0.42"],
    [12_345_678, "$12.35"],
    [10_000, "$0.01"],
    [9_999, "less than $0.01"],
    [1, "less than $0.01"],
  ])("shows %i as %s", (micros, expected) => {
    expect(formatDollars(micros)).toBe(expected);
  });
});

describe("dollarsFieldValue", () => {
  it.each([
    [3_000_000, "3"],
    [3_500_000, "3.5"],
    [5_000, "0.005"],
    [0, "0"],
  ])("shows %i as %s", (micros, expected) => {
    expect(dollarsFieldValue(micros)).toBe(expected);
  });

  it("round-trips through parseDollars", () => {
    for (const micros of [0, 1, 5_000, 3_000_000, 3_500_001, 999_999_999]) {
      expect(parseDollars(dollarsFieldValue(micros))).toBe(micros);
    }
  });
});
