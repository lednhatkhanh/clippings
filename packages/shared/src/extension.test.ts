import { describe, expect, it } from "vitest";

import { MAX_NOTE_LENGTH, MAX_TITLE_LENGTH } from "./clipping.ts";
import { extensionUpdateRequestSchema, isSaveablePage } from "./extension.ts";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_CLIPPING } from "./tag.ts";

describe("isSaveablePage", () => {
  it.each([
    "https://example.com/article",
    "http://example.com/",
    "https://chrome.google.com/search",
    "https://microsoftedge.microsoft.com/",
  ])("saves the web page %s", (address) => {
    expect(isSaveablePage(address)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "chrome://extensions/",
    "chrome-extension://niennihgpnpplljbiaddgeoliojiffdc/popup.html",
    "edge://settings",
    "about:blank",
    "file:///Users/ada/notes.html",
    "view-source:https://example.com/",
    "data:text/html,hi",
    "https://chromewebstore.google.com/detail/abc",
    "https://chrome.google.com/webstore/detail/abc",
    "https://microsoftedge.microsoft.com/addons/detail/abc",
    "https://addons.mozilla.org/en-US/firefox/",
    "https://user:secret@example.com/",
  ])("can't save %s", (address) => {
    expect(isSaveablePage(address)).toBe(false);
  });
});

describe("extensionUpdateRequestSchema", () => {
  it.each([
    ["a note", { note: "Worth it" }],
    ["an empty note, which clears it", { note: "" }],
    ["tags", { tags: ["Reading", "ideas"] }],
    ["no tags, which clears them", { tags: [] }],
    ["both", { note: "Worth it", tags: ["Reading"] }],
    ["a title", { title: "My name for it" }],
    ["an empty title, which goes back to the page's", { title: "" }],
    ["a null title, which goes back to the page's", { title: null }],
    ["a title at the limit", { title: "x".repeat(MAX_TITLE_LENGTH) }],
    ["a note at the limit", { note: "x".repeat(MAX_NOTE_LENGTH) }],
    [
      "tags at the limits",
      { tags: Array.from({ length: MAX_TAGS_PER_CLIPPING }, () => "x".repeat(MAX_TAG_LENGTH)) },
    ],
  ])("accepts %s", (_name, body) => {
    expect(extensionUpdateRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ["nothing to change", {}],
    ["only unknown fields", { summary: "New summary" }],
    ["a title past the limit", { title: "x".repeat(MAX_TITLE_LENGTH + 1) }],
    ["a note that is undefined", { note: undefined }],
    ["a note past the limit", { note: "x".repeat(MAX_NOTE_LENGTH + 1) }],
    ["a tag past the limit", { tags: ["x".repeat(MAX_TAG_LENGTH + 1)] }],
    [
      "too many tags",
      { tags: Array.from({ length: MAX_TAGS_PER_CLIPPING + 1 }, (_, i) => `t${i}`) },
    ],
    ["a note that isn't text", { note: 42 }],
    ["tags that aren't a list", { tags: "Reading" }],
    ["a body that isn't an object", "note"],
  ])("refuses %s", (_name, body) => {
    expect(extensionUpdateRequestSchema.safeParse(body).success).toBe(false);
  });
});
