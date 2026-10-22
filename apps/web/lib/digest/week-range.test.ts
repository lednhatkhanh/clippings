import { describe, expect, it } from "vitest";

import { formatWeekRange } from "./week-range.ts";

describe("formatWeekRange", () => {
  it.each([
    ["2026-09-21", "2026-09-27", "21 – 27 Sep 2026"],
    ["2026-09-28", "2026-10-04", "28 Sep – 4 Oct 2026"],
    ["2026-12-28", "2027-01-03", "28 Dec 2026 – 3 Jan 2027"],
    ["2026-03-02", "2026-03-08", "2 – 8 Mar 2026"],
  ])("words %s to %s as %s", (start, end, expected) => {
    expect(formatWeekRange(start, end)).toBe(expected);
  });
});
