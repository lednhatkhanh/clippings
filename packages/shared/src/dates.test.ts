import { parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import { formatAbsoluteDate } from "./dates.ts";

const now = parseISO("2026-10-18T12:00:00.000Z");

describe("formatAbsoluteDate", () => {
  it("leaves the year off in the current year", () => {
    expect(formatAbsoluteDate("2026-10-03T08:00:00.000Z", now)).toBe("3 Oct");
  });

  it("adds the year for other years", () => {
    expect(formatAbsoluteDate("2025-10-03T08:00:00.000Z", now)).toBe("3 Oct 2025");
  });

  it("uses UTC days", () => {
    expect(formatAbsoluteDate("2026-10-03T23:59:59.000Z", now)).toBe("3 Oct");
    expect(formatAbsoluteDate("2025-12-31T23:59:59.000Z", now)).toBe("31 Dec 2025");
  });
});
