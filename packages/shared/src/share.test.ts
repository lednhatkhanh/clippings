import { describe, expect, it } from "vitest";

import { extractSharedUrl } from "./share.ts";

describe("extractSharedUrl", () => {
  it("takes the url field over a link in the text", () => {
    expect(
      extractSharedUrl({
        url: "https://example.com/article",
        text: "Also see https://other.example/page",
        title: "An article",
      }),
    ).toEqual({
      ok: true,
      url: "https://example.com/article",
      quote: "Also see https://other.example/page",
    });
  });

  it("finds the link inside the text and quotes the rest", () => {
    expect(extractSharedUrl({ text: "Worth a read https://example.com/post?id=7." })).toEqual({
      ok: true,
      url: "https://example.com/post?id=7",
      quote: "Worth a read",
    });
  });

  it("finds the link inside the title when the text has none", () => {
    expect(
      extractSharedUrl({ title: "Look at this https://example.com/x", text: "So good" }),
    ).toEqual({ ok: true, url: "https://example.com/x", quote: "So good" });
  });

  it("leaves the link and the repeated title out of the quote", () => {
    expect(
      extractSharedUrl({
        title: "How to bake bread",
        text: "How to bake bread - https://example.com/bread",
      }),
    ).toEqual({ ok: true, url: "https://example.com/bread" });
  });

  it("removes the title only where it stands on its own, not inside a word", () => {
    expect(extractSharedUrl({ title: "Read", text: "Ready to go https://a.example/x" })).toEqual({
      ok: true,
      url: "https://a.example/x",
      quote: "Ready to go",
    });
  });

  it("closes up the gap the link leaves", () => {
    expect(
      extractSharedUrl({ text: "See https://a.example/x and more\nhttps://a.example/x\nThe end" }),
    ).toEqual({ ok: true, url: "https://a.example/x", quote: "See and more\nThe end" });
  });

  it("takes the url field only when it is a web address, not words", () => {
    expect(extractSharedUrl({ url: "note", text: "hi https://a.example/x" })).toEqual({
      ok: true,
      url: "https://a.example/x",
      quote: "hi",
    });
  });

  it("leaves out a closing bracket around the link", () => {
    expect(extractSharedUrl({ text: "Good one (https://a.example/x). Agreed" })).toEqual({
      ok: true,
      url: "https://a.example/x",
      quote: "Good one. Agreed",
    });
  });

  it.each([
    { name: "a blank share", share: { url: "  ", text: "\n ", title: " " } },
    { name: "a share with words but no link", share: { text: "Call me later", title: "Note" } },
    { name: "a share whose url field isn't a web address", share: { url: "mailto:a@b.c" } },
  ])("says there is nothing to save for $name", ({ share }) => {
    expect(extractSharedUrl(share)).toEqual({ ok: false, reason: "no-link" });
  });
});
