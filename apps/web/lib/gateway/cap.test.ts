import { describe, expect, it } from "vitest";

import { MODEL_JOB_KINDS, type ModelJobKind } from "@clippings/shared";

import { mayCall, spendLimitMicros } from "./cap.ts";

const CAP = 3_000_000;

describe("spendLimitMicros", () => {
  it.each([
    ["enrich", CAP, 3_000_000],
    ["search", CAP, 2_400_000],
    ["brief", CAP, 2_400_000],
    ["lesson", CAP, 2_400_000],
    ["librarian", CAP, 2_400_000],
    ["enrich", 0, 0],
    ["librarian", 0, 0],
    ["librarian", 7, 5],
  ] as const)("a %s job under a cap of %i stops at %i", (jobKind, cap, expected) => {
    expect(spendLimitMicros(jobKind, cap)).toBe(expected);
  });
});

describe("mayCall", () => {
  const may = (jobKind: ModelJobKind, spentTodayMicros: number, dailyCapMicros = CAP) =>
    mayCall({ jobKind, spentTodayMicros, dailyCapMicros });

  it.each([
    // [job kind, spent so far, may it call?]
    ["enrich", 0, true],
    ["enrich", 2_999_999, true],
    ["enrich", 3_000_000, false],
    ["enrich", 4_000_000, false],
    ["librarian", 0, true],
    ["librarian", 2_399_999, true],
    ["librarian", 2_400_000, false],
    ["librarian", 2_999_999, false],
    ["lesson", 2_400_000, false],
    ["brief", 2_400_000, false],
    ["search", 2_400_000, false],
    ["search", 2_399_999, true],
  ] as const)("%s with %i spent: %s", (jobKind, spent, expected) => {
    expect(may(jobKind, spent)).toBe(expected);
  });

  it("keeps the last fifth of the cap for saves: every other kind stops where enrich still goes on", () => {
    for (const jobKind of MODEL_JOB_KINDS.filter((kind) => kind !== "enrich")) {
      expect(may(jobKind, 2_700_000)).toBe(false);
      expect(may("enrich", 2_700_000)).toBe(true);
    }
  });

  it("holds every job when the cap is zero", () => {
    for (const jobKind of MODEL_JOB_KINDS) expect(may(jobKind, 0, 0)).toBe(false);
  });
});
