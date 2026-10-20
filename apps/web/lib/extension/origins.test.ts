import { describe, expect, it } from "vitest";

import { CLIPPINGS_EXTENSION_ID } from "@clippings/shared";

import {
  extensionErrorRedirect,
  extensionRedirectUri,
  isExtensionRedirectUri,
  parseExtensionIds,
} from "./origins.ts";

const STORE_ID = "abcdefghijklmnopabcdefghijklmnop";
const OTHER_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";

describe("parseExtensionIds", () => {
  it("always trusts the pinned extension, and adds the ids in the variable", () => {
    expect(parseExtensionIds(undefined)).toEqual([CLIPPINGS_EXTENSION_ID]);
    expect(parseExtensionIds("")).toEqual([CLIPPINGS_EXTENSION_ID]);
    expect(parseExtensionIds(`${STORE_ID},${OTHER_ID}`)).toEqual([
      CLIPPINGS_EXTENSION_ID,
      STORE_ID,
      OTHER_ID,
    ]);
  });

  it("splits on commas and any whitespace, and lists an id once", () => {
    expect(parseExtensionIds(` ${STORE_ID} ,\n${OTHER_ID}\t${STORE_ID},,`)).toEqual([
      CLIPPINGS_EXTENSION_ID,
      STORE_ID,
      OTHER_ID,
    ]);
    expect(parseExtensionIds(CLIPPINGS_EXTENSION_ID)).toEqual([CLIPPINGS_EXTENSION_ID]);
  });

  it.each([
    "tooshort",
    `${STORE_ID}x`,
    STORE_ID.toUpperCase(),
    // Extension ids use the letters a to p only.
    "q".repeat(32),
    `chrome-extension://${STORE_ID}`,
  ])("drops %s, which isn't an extension id", (entry) => {
    expect(parseExtensionIds(entry)).toEqual([CLIPPINGS_EXTENSION_ID]);
  });
});

describe("isExtensionRedirectUri", () => {
  const trusted = [CLIPPINGS_EXTENSION_ID, STORE_ID];

  it("accepts a trusted extension's chromiumapp.org redirect", () => {
    expect(isExtensionRedirectUri(extensionRedirectUri(CLIPPINGS_EXTENSION_ID), trusted)).toBe(
      true,
    );
    expect(isExtensionRedirectUri(`https://${STORE_ID}.chromiumapp.org/`, trusted)).toBe(true);
  });

  it.each([
    // Another extension, and none trusted.
    `https://${OTHER_ID}.chromiumapp.org/`,
    // Not exactly the redirect the identity API hands out.
    `https://${STORE_ID}.chromiumapp.org`,
    `https://${STORE_ID}.chromiumapp.org/callback`,
    `https://${STORE_ID}.chromiumapp.org/?next=https://evil.example`,
    `http://${STORE_ID}.chromiumapp.org/`,
    `https://${STORE_ID}.chromiumapp.org.evil.example/`,
    `https://evil.example/${STORE_ID}.chromiumapp.org/`,
    `https://user@${STORE_ID}.chromiumapp.org/`,
    `chrome-extension://${STORE_ID}/`,
    "",
  ])("refuses %s", (uri) => {
    expect(isExtensionRedirectUri(uri, trusted)).toBe(false);
  });

  it("trusts nobody when no extension is trusted", () => {
    expect(isExtensionRedirectUri(extensionRedirectUri(CLIPPINGS_EXTENSION_ID), [])).toBe(false);
  });
});

describe("extensionErrorRedirect", () => {
  const redirectUri = extensionRedirectUri(CLIPPINGS_EXTENSION_ID);
  const ids = [CLIPPINGS_EXTENSION_ID];

  it("sends the extension back to itself with the error, its reason and the state it sent", () => {
    const query = new URLSearchParams({ redirect_uri: redirectUri, state: "s-1" });

    const url = new URL(extensionErrorRedirect(query, ids, "access_denied", "not_allowlisted")!);

    expect(`${url.origin}${url.pathname}`).toBe(redirectUri);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: "access_denied",
      error_description: "not_allowlisted",
      state: "s-1",
    });
  });

  it("leaves out a state the extension didn't send", () => {
    const query = new URLSearchParams({ redirect_uri: redirectUri });

    const url = new URL(extensionErrorRedirect(query, ids, "access_denied", "denied")!);

    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.get("error_description")).toBe("denied");
  });

  it.each([
    ["a loopback client", "http://127.0.0.1:43210/callback"],
    ["an extension that isn't trusted", extensionRedirectUri(OTHER_ID)],
    ["a request without a redirect", ""],
  ])("is undefined for %s, so the error never leaves for another site", (_name, uri) => {
    const query = new URLSearchParams({ redirect_uri: uri, state: "s-1" });
    expect(extensionErrorRedirect(query, ids, "access_denied", "not_allowlisted")).toBeUndefined();
  });
});
