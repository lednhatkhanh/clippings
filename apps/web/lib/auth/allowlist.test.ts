import { describe, expect, it } from "vitest";

import { isAllowlisted, parseAllowlist } from "./allowlist";

describe("parseAllowlist", () => {
  it("splits on commas and whitespace, lowercases and trims", () => {
    const list = parseAllowlist(" Ada@Example.com,grace@example.com\n  linus@example.com ");

    expect(list).toEqual(["ada@example.com", "grace@example.com", "linus@example.com"]);
  });

  it("is empty for an unset or blank variable", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("  ,  ")).toEqual([]);
  });
});

describe("isAllowlisted", () => {
  const list = parseAllowlist("ada@example.com");

  it("matches case-insensitively", () => {
    expect(isAllowlisted(list, "Ada@Example.com")).toBe(true);
  });

  it("rejects other emails, including lookalikes", () => {
    expect(isAllowlisted(list, "grace@example.com")).toBe(false);
    expect(isAllowlisted(list, "ada@example.com.evil.test")).toBe(false);
    expect(isAllowlisted(list, "xada@example.com")).toBe(false);
  });

  it("rejects a missing email and an empty allowlist", () => {
    expect(isAllowlisted(list, undefined)).toBe(false);
    expect(isAllowlisted(list, "")).toBe(false);
    expect(isAllowlisted([], "ada@example.com")).toBe(false);
  });
});
