import { parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import { formatAbsoluteDate, formatClippingDate, formatLastUsed } from "./format-date.ts";

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

describe("formatClippingDate", () => {
  it.each([
    ["2026-10-18T11:59:30.000Z", "Just now"],
    ["2026-10-18T11:55:00.000Z", "5 minutes ago"],
    ["2026-10-18T09:00:00.000Z", "3 hours ago"],
    ["2026-10-17T11:00:00.000Z", "yesterday"],
    ["2026-10-14T12:00:00.000Z", "4 days ago"],
    ["2026-10-11T12:00:00.000Z", "11 Oct"],
    ["2026-10-18T12:05:00.000Z", "Just now"],
  ])("words %s as %s", (iso, label) => {
    expect(formatClippingDate(iso, now)).toBe(label);
  });
});

describe("formatLastUsed", () => {
  it.each([
    [null, "Not used yet"],
    ["2026-10-18T11:59:30.000Z", "Last used just now"],
    ["2026-10-18T09:00:00.000Z", "Last used 3 hours ago"],
    ["2026-10-17T11:00:00.000Z", "Last used yesterday"],
    ["2026-10-11T12:00:00.000Z", "Last used on 11 Oct"],
    ["2025-10-11T12:00:00.000Z", "Last used on 11 Oct 2025"],
  ])("words %s as %s", (iso, label) => {
    expect(formatLastUsed(iso, now)).toBe(label);
  });
});
