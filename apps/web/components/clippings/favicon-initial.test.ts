import { describe, expect, it } from "vitest";

import { faviconInitial } from "./favicon-initial.ts";

describe("faviconInitial", () => {
  it.each([
    { url: "https://jeffhuang.com/designs", initial: "J" },
    { url: "https://www.calmtech.com/", initial: "C" },
    { url: "https://developer.mozilla.org/en-US/docs", initial: "D" },
    { url: "http://localhost:3000/a", initial: "L" },
    { url: "not a url", initial: "?" },
    { url: "", initial: "?" },
  ])("$url is $initial", ({ url, initial }) => {
    expect(faviconInitial(url)).toBe(initial);
  });
});
