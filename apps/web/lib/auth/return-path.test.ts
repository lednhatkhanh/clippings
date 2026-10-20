import { describe, expect, it } from "vitest";

import { safeReturnPath, signInPath } from "./return-path.ts";

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

describe("signInPath", () => {
  it("returns to the page asked for", () => {
    expect(signInPath("/share?url=https%3A%2F%2Fexample.com")).toBe(
      "/sign-in?returnTo=%2Fshare%3Furl%3Dhttps%253A%252F%252Fexample.com",
    );
  });

  it.each(["/", "https://evil.example/share", "//evil.example", null])(
    "goes to plain sign-in for %j",
    (requested) => {
      expect(signInPath(requested)).toBe("/sign-in");
    },
  );
});
