import { describe, expect, it } from "vitest";

import { droppedUrl } from "./dropped-url.ts";

describe("droppedUrl", () => {
  it("reads a dragged link from its uri-list", () => {
    expect(droppedUrl({ uriList: "https://example.com/a", text: "Example" })).toBe(
      "https://example.com/a",
    );
  });

  it("skips uri-list comments and takes the first address", () => {
    expect(
      droppedUrl({
        uriList: "# a comment\r\nhttps://example.com/one\r\nhttps://example.com/two",
        text: "",
      }),
    ).toBe("https://example.com/one");
  });

  it("reads plain text that is one http(s) address", () => {
    expect(droppedUrl({ uriList: "", text: "  http://Example.com/page  " })).toBe(
      "http://example.com/page",
    );
  });

  it("ignores text that isn't an address", () => {
    expect(droppedUrl({ uriList: "", text: "example" })).toBeNull();
    expect(droppedUrl({ uriList: "", text: "example.com" })).toBeNull();
    expect(droppedUrl({ uriList: "", text: "see https://example.com" })).toBeNull();
    expect(droppedUrl({ uriList: "", text: "https://example.com and more" })).toBeNull();
    expect(droppedUrl({ uriList: "", text: "" })).toBeNull();
  });

  it("ignores other schemes", () => {
    expect(droppedUrl({ uriList: "javascript:alert(1)", text: "" })).toBeNull();
    expect(droppedUrl({ uriList: "file:///etc/hosts", text: "" })).toBeNull();
    expect(droppedUrl({ uriList: "", text: "mailto:someone@example.com" })).toBeNull();
  });
});
