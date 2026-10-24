import { describe, expect, it } from "vitest";

import { parseWebUrl } from "./url.ts";

describe("parseWebUrl", () => {
  describe("url: the address made absolute", () => {
    it.each([
      ["a full https address", "https://example.com/essay", "https://example.com/essay"],
      ["a full http address", "http://example.com/essay", "http://example.com/essay"],
      ["a bare domain, read as https", "example.com/essay", "https://example.com/essay"],
      ["surrounding whitespace", "  https://example.com/essay\n", "https://example.com/essay"],
      ["an upper-case host", "https://EXAMPLE.com/Essay", "https://example.com/Essay"],
      ["a host with a port", "localhost:3000/page", "https://localhost:3000/page"],
      ["localhost with a port", "localhost:3000", "https://localhost:3000/"],
      ["a domain with a port and path", "example.com:8080/path", "https://example.com:8080/path"],
      ["an IPv4 address with a port", "127.0.0.1:3000", "https://127.0.0.1:3000/"],
      ["an IPv6 literal", "[::1]:3000/page", "https://[::1]:3000/page"],
      [
        "tracking and a fragment, which stay in what the user gave",
        "https://example.com/essay/?utm_source=feed&id=7#part-2",
        "https://example.com/essay/?utm_source=feed&id=7#part-2",
      ],
    ])("reads %s", (_label, input, url) => {
      expect(parseWebUrl(input)?.url).toBe(url);
    });
  });

  describe("normalized: what two saves of the same page share", () => {
    it.each([
      ["a plain address", "https://example.com/essay", "https://example.com/essay"],
      ["the host's case", "https://EXAMPLE.com/essay", "https://example.com/essay"],
      ["a trailing slash", "https://example.com/essay/", "https://example.com/essay"],
      ["several trailing slashes", "https://example.com/essay///", "https://example.com/essay"],
      ["the root path", "https://example.com/", "https://example.com"],
      ["a missing scheme", "example.com/essay", "https://example.com/essay"],
      ["a fragment", "https://example.com/essay#section-2", "https://example.com/essay"],
      ["a default https port", "https://example.com:443/essay", "https://example.com/essay"],
      ["a default http port", "http://example.com:80/essay", "http://example.com/essay"],
      [
        "utm parameters",
        "https://example.com/essay?utm_source=feed&utm_medium=rss",
        "https://example.com/essay",
      ],
      ["a tracking id", "https://example.com/essay?fbclid=abc", "https://example.com/essay"],
      [
        "a tracking name in another case",
        "https://example.com/essay?GCLID=abc",
        "https://example.com/essay",
      ],
      [
        "tracking next to a real parameter",
        "https://example.com/essay?utm_source=newsletter&id=7&fbclid=abc",
        "https://example.com/essay?id=7",
      ],
      [
        "the order of parameters",
        "https://example.com/essay?b=2&a=1",
        "https://example.com/essay?a=1&b=2",
      ],
    ])("ignores %s", (_label, input, normalized) => {
      expect(parseWebUrl(input)?.normalized).toBe(normalized);
    });

    it.each([
      ["a different path", "https://example.com/a", "https://example.com/b"],
      ["a different query value", "https://example.com/a?id=1", "https://example.com/a?id=2"],
      ["a different parameter name", "https://example.com/a?id=1", "https://example.com/a?page=1"],
      ["a different host", "https://example.com/a", "https://www.example.com/a"],
      ["a different scheme", "https://example.com/a", "http://example.com/a"],
      ["a non-default port", "https://example.com/a", "https://example.com:8443/a"],
      ["the case of the path", "https://example.com/Essay", "https://example.com/essay"],
    ])("keeps %s as a different page", (_label, one, other) => {
      expect(parseWebUrl(one)?.normalized).not.toBe(parseWebUrl(other)?.normalized);
    });

    it("reads the same page the same way however the user wrote it", () => {
      const variants = [
        "https://example.com/essay?id=7",
        "https://EXAMPLE.com/essay?id=7",
        "https://example.com/essay/?id=7",
        "https://example.com/essay?id=7#section-2",
        "https://example.com/essay?utm_source=newsletter&id=7&fbclid=abc",
        "example.com/essay?id=7",
      ];
      expect(new Set(variants.map((variant) => parseWebUrl(variant)?.normalized))).toEqual(
        new Set(["https://example.com/essay?id=7"]),
      );
    });
  });

  describe("what is not a web address", () => {
    it.each([
      ["nothing", ""],
      ["only whitespace", "   "],
      ["mailto", "mailto:ana@example.com"],
      ["javascript", "javascript:alert(1)"],
      ["javascript dressed as an address", 'javascript:alert(1);"@example.com"'],
      ["data", "data:text/html,hello"],
      ["ftp", "ftp://example.com/file"],
      ["file", "file:///etc/passwd"],
      ["credentials", "https://ana:secret@example.com/private"],
      ["only a user name", "https://ana@example.com/private"],
      ["words", "not a url at all"],
      ["a phone number link", "tel:123"],
      ["an sms link", "sms:12345"],
      ["a bare word", "hello"],
      ["a bare word with a path", "hello/world"],
      ["a bare word with a port", "intranet:8080"],
      ["a scheme with no host", "https://"],
    ])("refuses %s", (_label, input) => {
      expect(parseWebUrl(input)).toBeNull();
    });
  });
});
