import { describe, expect, it } from "vitest";

import { safeReturnPath } from "./return-path.ts";

describe("safeReturnPath", () => {
  it("keeps a path on this site with its query", () => {
    expect(safeReturnPath("/share?url=https%3A%2F%2Fexample.com&title=Hi")).toBe(
      "/share?url=https%3A%2F%2Fexample.com&title=Hi",
    );
  });

  it.each([
    "https://evil.example/share",
    "//evil.example/share",
    "/\\evil.example/share",
    "/\t/evil.example",
    "/.//evil.example",
    "share",
    "",
    undefined,
  ])("ignores %j", (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });
});
