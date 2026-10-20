import { parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import { formatClippingDate, formatLastUsed } from "./format-date.ts";

const now = parseISO("2026-10-18T12:00:00.000Z");

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
