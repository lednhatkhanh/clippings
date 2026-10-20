import { describe, expect, it } from "vitest";

import { isSaveablePage } from "./extension.ts";

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
