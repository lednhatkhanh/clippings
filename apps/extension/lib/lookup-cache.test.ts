import { describe, expect, it } from "vitest";

import {
  cachedLookup,
  LOOKUP_TTL_MS,
  MAX_CACHED_LOOKUPS,
  rememberLookup,
  type LookupCache,
} from "./lookup-cache.ts";

const URL = "https://example.com/essay";
const NOW = 1_000_000_000;

describe("cachedLookup", () => {
  const cache: LookupCache = {
    [URL]: { saved: true, at: NOW },
    "https://example.com/other": { saved: false, at: NOW },
  };

  it.each([
    { name: "a fresh saved answer", url: URL, now: NOW + 1000, expected: "saved" },
    {
      name: "a fresh answer that it is not saved",
      url: "https://example.com/other",
      now: NOW + 1000,
      expected: "not_saved",
    },
    { name: "the last moment of the time", url: URL, now: NOW + LOOKUP_TTL_MS - 1, expected: "saved" },
    { name: "an answer past its time", url: URL, now: NOW + LOOKUP_TTL_MS, expected: undefined },
    { name: "an address never asked about", url: "https://example.com/new", now: NOW, expected: undefined },
    { name: "an answer from the future (the clock moved back)", url: URL, now: NOW - 1, expected: undefined },
    { name: "a name every object has", url: "constructor", now: NOW, expected: undefined },
  ])("$name", ({ url, now, expected }) => {
    expect(cachedLookup(cache, url, now)).toBe(expected);
  });
});

describe("rememberLookup", () => {
  it("sets the answer, replacing the one for the same address", () => {
    const before = rememberLookup({}, URL, false, NOW);

    const after = rememberLookup(before, URL, true, NOW + 5000);

    expect(after).toEqual({ [URL]: { saved: true, at: NOW + 5000 } });
    expect(cachedLookup(after, URL, NOW + 6000)).toBe("saved");
  });

  it("leaves other addresses alone and drops the answers past their time", () => {
    const cache: LookupCache = {
      "https://example.com/old": { saved: true, at: NOW },
      "https://example.com/recent": { saved: false, at: NOW + LOOKUP_TTL_MS - 1000 },
    };

    const after = rememberLookup(cache, URL, true, NOW + LOOKUP_TTL_MS);

    expect(Object.keys(after).toSorted()).toEqual(["https://example.com/recent", URL].toSorted());
  });

  it("keeps the newest MAX_CACHED_LOOKUPS answers", () => {
    let cache: LookupCache = {};
    for (let n = 0; n < MAX_CACHED_LOOKUPS + 20; n++) {
      cache = rememberLookup(cache, `https://example.com/${n}`, false, NOW + n);
    }

    expect(Object.keys(cache)).toHaveLength(MAX_CACHED_LOOKUPS);
    expect(cache["https://example.com/0"]).toBeUndefined();
    expect(cache[`https://example.com/${MAX_CACHED_LOOKUPS + 19}`]).toBeDefined();
  });
});
