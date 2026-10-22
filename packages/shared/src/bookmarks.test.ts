import { fromUnixTime, getUnixTime, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  MAX_BOOKMARKS_FILE_BYTES,
  MAX_BOOKMARKS_PER_IMPORT,
  parseBookmarksHtml,
  serializeBookmarksHtml,
  type BookmarkToExport,
  type ParsedBookmark,
} from "./bookmarks.ts";
import { MAX_TAGS_PER_CLIPPING } from "./tag.ts";

const CHROME = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000100" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/essay" ADD_DATE="1700000200" ICON="data:image/png;base64,AAAA">An essay</A>
        <DT><H3 ADD_DATE="1700000300" LAST_MODIFIED="1700000400">Reading</H3>
        <DL><p>
            <DT><A HREF="https://example.org/long-read" ADD_DATE="1700000500">A long read</A>
        </DL><p>
    </DL><p>
    <DT><H3 ADD_DATE="1700000600" LAST_MODIFIED="1700000700">Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://example.net/misc" ADD_DATE="1700000800">Misc</A>
    </DL><p>
</DL><p>
`;

const FIREFOX = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; img-src data: *; object-src 'none'"></meta>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>

<DL><p>
    <DT><H3 ADD_DATE="1650000000" LAST_MODIFIED="1650000001">Bookmarks Menu</H3>
    <DL><p>
        <DT><A HREF="https://developer.mozilla.org/" ADD_DATE="1650000010" LAST_MODIFIED="1650000020" TAGS="docs,web">MDN</A>
        <DT><A HREF="place:parent=1&amp;type=6&amp;sort=14" ADD_DATE="1650000030">Recent Tags</A>
    </DL><p>
    <DT><H3 ADD_DATE="1650000040" LAST_MODIFIED="1650000050" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>
    <DL><p>
        <DT><A HREF="https://www.rust-lang.org/" ADD_DATE="1650000060" ICON_URI="fake-favicon-uri:https://www.rust-lang.org/">Rust</A>
    </DL><p>
    <DT><H3 ADD_DATE="1650000070" LAST_MODIFIED="1650000080" UNFILED_BOOKMARKS_FOLDER="true">Other Bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1650000090">Hacker News</A>
    </DL><p>
</DL>
`;

const SAFARI = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<HTML>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<Title>Bookmarks</Title>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 FOLDED>Favorites</H3>
    <DL><p>
        <DT><A HREF="https://www.apple.com/">Apple</A>
    </DL><p>
    <DT><H3 FOLDED>Recipes</H3>
    <DL><p>
        <DT><A HREF="https://example.com/bread">Bread</A>
    </DL><p>
    <DT><A HREF="https://example.com/loose">Loose link</A>
</DL><p>
</HTML>
`;

const RAINDROP = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Raindrop.io</TITLE>
<H1>Raindrop.io</H1>
<DL><p>
<DT><H3 ADD_DATE="1600000000">Design</H3>
<DL><p>
<DT><H3 ADD_DATE="1600000001">Typography</H3>
<DL><p>
<DT><A HREF="https://fonts.example/guide" ADD_DATE="1600000100" LAST_MODIFIED="1600000200" TAGS="type, fonts ,,Guide">Font guide</A>
<DD>Notes are ignored
</DL><p>
</DL><p>
<DT><H3 ADD_DATE="1600000002">Unsorted</H3>
<DL><p>
<DT><A HREF="https://unsorted.example/" ADD_DATE="1600000300">Unsorted one</A>
</DL><p>
</DL><p>
`;

/** One bookmark per row, with the dates the fixtures spell. */
const bookmark = (
  url: string,
  title: string,
  addedAt: number | null,
  folders: string[],
): ParsedBookmark => ({
  url,
  title,
  addedAt: addedAt === null ? null : fromUnixTime(addedAt),
  folders,
});

function parse(html: string) {
  const result = parseBookmarksHtml(html);
  if (!result.ok) throw new Error(`expected a parse, got ${result.error}`);
  return result;
}

/** A file holding the given `<A>` lines in one top-level list. */
const fileWith = (...links: string[]): string =>
  `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n${links.map((l) => `<DT>${l}`).join("\n")}\n</DL><p>`;

describe("parseBookmarksHtml", () => {
  describe("files from each source", () => {
    it.each([
      [
        "Chrome: the bar and 'Other bookmarks' roots are dropped, nested folders kept",
        CHROME,
        [
          bookmark("https://example.com/essay", "An essay", 1700000200, []),
          bookmark("https://example.org/long-read", "A long read", 1700000500, ["Reading"]),
          bookmark("https://example.net/misc", "Misc", 1700000800, []),
        ],
        [],
      ],
      [
        "Firefox: roots dropped, TAGS joined, place: links skipped",
        FIREFOX,
        [
          bookmark("https://developer.mozilla.org/", "MDN", 1650000010, ["docs", "web"]),
          bookmark("https://www.rust-lang.org/", "Rust", 1650000060, []),
          bookmark("https://news.ycombinator.com/", "Hacker News", 1650000090, []),
        ],
        [{ url: "place:parent=1&type=6&sort=14", title: "Recent Tags", reason: "not_web" }],
      ],
      [
        "Safari: no ADD_DATE, 'Favorites' root dropped, a loose link at the top",
        SAFARI,
        [
          bookmark("https://www.apple.com/", "Apple", null, []),
          bookmark("https://example.com/bread", "Bread", null, ["Recipes"]),
          bookmark("https://example.com/loose", "Loose link", null, []),
        ],
        [],
      ],
      [
        "Raindrop: collections nest, TAGS are trimmed and empty ones dropped",
        RAINDROP,
        [
          bookmark("https://fonts.example/guide", "Font guide", 1600000100, [
            "Design",
            "Typography",
            "type",
            "fonts",
            "Guide",
          ]),
          bookmark("https://unsorted.example/", "Unsorted one", 1600000300, ["Unsorted"]),
        ],
        [],
      ],
    ])("%s", (_label, html, bookmarks, skipped) => {
      expect(parse(html)).toEqual({ ok: true, bookmarks, skipped });
    });
  });

  describe("folders", () => {
    it.each([
      [
        "a folder named like a root, below the top, is the user's own",
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><H3>Projects</H3>
<DL><p>
<DT><H3>Favorites</H3>
<DL><p><DT><A HREF="https://a.example/">A</A></DL><p>
</DL><p>
</DL><p>`,
        ["Projects", "Favorites"],
      ],
      [
        "a root marked PERSONAL_TOOLBAR_FOLDER goes by any name",
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Barre de favoris</H3>
<DL><p><DT><A HREF="https://a.example/">A</A></DL><p>
</DL><p>`,
        [],
      ],
      [
        "an empty folder does not name the list that follows it",
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><H3>Empty</H3>
<DT><A HREF="https://a.example/">A</A>
</DL><p>`,
        [],
      ],
      [
        "extra closing lists do not break what follows",
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
</DL></DL></DL>
<DL><DT><H3>Late</H3><DL><DT><A HREF="https://a.example/">A</A></DL></DL>`,
        ["Late"],
      ],
      [
        "a folder name with an entity",
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p><DT><H3>Q&amp;A &#38; more</H3><DL><p><DT><A HREF="https://a.example/">A</A></DL><p></DL><p>`,
        ["Q&A & more"],
      ],
    ])("%s", (_label, html, folders) => {
      expect(parse(html).bookmarks.map((b) => b.folders)).toEqual([folders]);
    });
  });

  describe("ADD_DATE", () => {
    it.each([
      ["seconds", "1700000000", 1700000000],
      ["milliseconds", "1700000000123", 1700000000],
      ["microseconds", "1700000000123456", 1700000000],
      ["surrounding whitespace", " 1700000000 ", 1700000000],
      ["zero", "0", null],
      ["text", "yesterday", null],
      ["a negative number", "-5", null],
      ["a fraction", "1700000000.5", null],
      ["an absurd magnitude", "99999999999999999999", null],
      ["an empty value", "", null],
    ])("reads %s", (_label, value, seconds) => {
      const { bookmarks } = parse(
        fileWith(`<A HREF="https://a.example/" ADD_DATE="${value}">A</A>`),
      );
      expect(bookmarks[0]?.addedAt).toEqual(seconds === null ? null : fromUnixTime(seconds));
    });

    it("is null when the attribute is absent", () => {
      const { bookmarks } = parse(fileWith(`<A HREF="https://a.example/">A</A>`));
      expect(bookmarks[0]?.addedAt).toBeNull();
    });
  });

  describe("non-web links", () => {
    it.each([
      ["javascript:", "javascript:void(0)"],
      ["file:", "file:///Users/me/notes.html"],
      ["chrome://", "chrome://settings/"],
      ["about:", "about:blank"],
      ["place:", "place:sort=8"],
      ["data:", "data:text/html,<h1>hi</h1>"],
      ["mailto:", "mailto:me@example.com"],
      ["ftp:", "ftp://files.example/readme"],
      ["a bare word", "not a url"],
    ])("skips %s with a reason and keeps its title", (_label, href) => {
      const result = parse(fileWith(`<A HREF="${href.replaceAll('"', "&quot;")}">Odd one</A>`));
      expect(result.bookmarks).toEqual([]);
      expect(result.skipped).toEqual([{ url: href, title: "Odd one", reason: "not_web" }]);
    });

    it("imports http and https, in any letter case", () => {
      const { bookmarks } = parse(
        fileWith(
          `<A HREF="http://plain.example/">Plain</A>`,
          `<A HREF="HTTPS://UPPER.example/">Upper</A>`,
        ),
      );
      expect(bookmarks.map((b) => b.url)).toEqual([
        "http://plain.example/",
        "HTTPS://UPPER.example/",
      ]);
    });

    it("ignores an anchor with no address", () => {
      const result = parse(fileWith(`<A NAME="top">Anchor</A>`, `<A HREF="">Empty</A>`));
      expect(result).toEqual({ ok: true, bookmarks: [], skipped: [] });
    });
  });

  describe("text and attributes", () => {
    it.each([
      ["&amp;", "Tom &amp; Jerry", "Tom & Jerry"],
      ["&lt; and &gt;", "a &lt;b&gt; c", "a <b> c"],
      ["&quot; and &#39;", "&quot;Quoted&quot; &#39;single&#39;", `"Quoted" 'single'`],
      ["&#x27; (hex)", "It&#x27;s", "It's"],
      ["a numeric emoji", "Rocket &#128640;", "Rocket \u{1f680}"],
      ["an unknown entity, left as typed", "AT&T &bogus; ok", "AT&T &bogus; ok"],
      ["an out-of-range number, left as typed", "x &#99999999; y", "x &#99999999; y"],
      ["an entity decoded only once", "&amp;amp;", "&amp;"],
      ["inner tags, dropped", "<b>Bold</b> and <i>italic</i>", "Bold and italic"],
      ["runs of whitespace", "  two\n   lines\t here ", "two lines here"],
    ])("decodes %s in a title", (_label, raw, title) => {
      const { bookmarks } = parse(fileWith(`<A HREF="https://a.example/">${raw}</A>`));
      expect(bookmarks[0]?.title).toBe(title);
    });

    it("decodes entities in the address", () => {
      const { bookmarks } = parse(fileWith(`<A HREF="https://a.example/?x=1&amp;y=2">A</A>`));
      expect(bookmarks[0]?.url).toBe("https://a.example/?x=1&y=2");
    });

    it.each([
      ["single quotes", `<A HREF='https://a.example/' ADD_DATE='1700000000'>A</A>`],
      ["no quotes", `<A HREF=https://a.example/ ADD_DATE=1700000000>A</A>`],
      ["lower case", `<a href="https://a.example/" add_date="1700000000">A</a>`],
      [
        "a '>' inside a quoted value",
        `<A TITLE="a > b" HREF="https://a.example/" ADD_DATE="1700000000">A</A>`,
      ],
      ["no closing tag", `<A HREF="https://a.example/" ADD_DATE="1700000000">A`],
    ])("reads an anchor written with %s", (_label, link) => {
      expect(parse(fileWith(link)).bookmarks).toEqual([
        bookmark("https://a.example/", "A", 1700000000, []),
      ]);
    });

    it("gives an empty title when the link has no text", () => {
      const { bookmarks } = parse(fileWith(`<A HREF="https://a.example/"></A>`));
      expect(bookmarks[0]?.title).toBe("");
    });
  });

  describe("input that is not a bookmarks file", () => {
    it.each([
      ["an empty string", ""],
      ["plain text", "just some notes about bookmarks"],
      [
        "an ordinary web page",
        `<html><body><p>Hi <a href="https://a.example/">link</a></p></body></html>`,
      ],
      ["JSON", `{"bookmarks":[{"url":"https://a.example/"}]}`],
      ["binary garbage", "\u0000\u0001��PNG\r\n\u001a\n\u0000\u0000<<<>>><a"],
    ])("rejects %s", (_label, input) => {
      expect(parseBookmarksHtml(input)).toEqual({ ok: false, error: "not_bookmarks" });
    });

    it("accepts a file with the header and no links as empty", () => {
      expect(parse("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p></DL><p>")).toEqual({
        ok: true,
        bookmarks: [],
        skipped: [],
      });
    });
  });

  describe("malformed markup", () => {
    it.each([
      [
        "an unclosed quote",
        `<A HREF="https://a.example/ ADD_DATE="1">Broken</A>\n<DT><A HREF="https://b.example/">B</A>`,
      ],
      [
        "a tag cut off at the end",
        `<DT><A HREF="https://b.example/">B</A>\n<DT><A HREF="https://c.exa`,
      ],
      ["stray angle brackets", `<<< >>> <DT><A HREF="https://b.example/">B</A> < 3 <`],
      ["an unclosed comment", `<DT><A HREF="https://b.example/">B</A><!-- never closed`],
      ["tags nested wrongly", `<DT><A HREF="https://b.example/"><DL><H3>B</A></H3></DL>`],
    ])("does not throw on %s", (_label, body) => {
      const input = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n${body}`;
      expect(() => parseBookmarksHtml(input)).not.toThrow();
      expect(parseBookmarksHtml(input).ok).toBe(true);
    });

    it("keeps the links it can read around the damage", () => {
      const { bookmarks } = parse(
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n<DT><A HREF="https://b.example/">B</A> <<< \n<DT><A HREF="https://c.example/">C</A>`,
      );
      expect(bookmarks.map((b) => b.url)).toEqual(["https://b.example/", "https://c.example/"]);
    });

    it("reads a file with a byte order mark and CRLF line ends", () => {
      const html = `﻿${CHROME.replaceAll("\n", "\r\n")}`;
      expect(parse(html).bookmarks).toHaveLength(3);
    });

    it("stays fast on many unclosed tags", () => {
      const started = performance.now();
      parseBookmarksHtml(
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL>${'<A HREF="x '.repeat(200_000)}`,
      );
      parseBookmarksHtml(`<DL><DT>${"<a ".repeat(200_000)}`);
      expect(performance.now() - started).toBeLessThan(2_000);
    });
  });

  describe("limits", () => {
    const links = (count: number, prefix = "https") =>
      Array.from({ length: count }, (_, i) => `<A HREF="${prefix}://a.example/${i}">${i}</A>`);

    it("takes exactly the most bookmarks", () => {
      const result = parse(fileWith(...links(MAX_BOOKMARKS_PER_IMPORT)));
      expect(result.bookmarks).toHaveLength(MAX_BOOKMARKS_PER_IMPORT);
    });

    it("rejects one more", () => {
      expect(parseBookmarksHtml(fileWith(...links(MAX_BOOKMARKS_PER_IMPORT + 1)))).toEqual({
        ok: false,
        error: "too_many",
      });
    });

    it("counts only importable links", () => {
      const result = parse(fileWith(...links(MAX_BOOKMARKS_PER_IMPORT + 10, "javascript")));
      expect(result.bookmarks).toEqual([]);
      expect(result.skipped).toHaveLength(MAX_BOOKMARKS_PER_IMPORT + 10);
    });
  });

  describe("adversarial nesting", () => {
    const timed = <T>(run: () => T): { result: T; ms: number } => {
      const started = performance.now();
      const result = run();
      return { result, ms: performance.now() - started };
    };
    const links = (count: number) =>
      Array.from({ length: count }, (_, i) => `<DT><A HREF="https://a.example/${i}">${i}</A>`).join(
        "",
      );

    it("reads a run of lists then folders in linear time", () => {
      // Every list left open, then every folder: as deep as a file of this size can nest.
      const listsThenFolders = (count: number) =>
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>${"<DL>".repeat(count)}${"<H3>".repeat(count)}`;
      // As many tags, each list closed at once, so it never nests.
      const shallowLists = (count: number) =>
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>${"<DL></DL>".repeat(count)}`;
      // Best of five after a warm-up, so one slow run on a busy machine doesn't decide it.
      const fastest = (html: string) => {
        parseBookmarksHtml(html);
        return Math.min(...[1, 2, 3, 4, 5].map(() => timed(() => parseBookmarksHtml(html)).ms));
      };
      // Half the largest file: quadratic already shows at this size.
      const count = Math.floor(MAX_BOOKMARKS_FILE_BYTES / 16);
      const deep = listsThenFolders(count);
      expect(timed(() => parseBookmarksHtml(deep)).result).toEqual({
        ok: true,
        bookmarks: [],
        skipped: [],
      });
      // The deepest file against a flat one of the same size, not against a smaller deep one,
      // which on a CI runner made linear work look superlinear. Linear parsing keeps them about
      // 2 apart on a laptop and up to about 10 on a busy runner; work that grows with the depth
      // makes the deep one over a thousand times slower. 100 sits between the two.
      const ratio = fastest(deep) / Math.max(fastest(shallowLists(count)), 1);
      expect(ratio).toBeLessThan(100);
    }, 30_000);

    it("names no more folders than the cap, however deep and however many links", () => {
      const depth = 50_000;
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>${"<DT><H3>f</H3><DL>".repeat(depth)}${links(MAX_BOOKMARKS_PER_IMPORT)}`;
      const result = parseBookmarksHtml(html);
      if (!result.ok) throw new Error("expected a parse");
      expect(result.bookmarks).toHaveLength(MAX_BOOKMARKS_PER_IMPORT);
      for (const bookmark of result.bookmarks) {
        expect(bookmark.folders).toHaveLength(MAX_TAGS_PER_CLIPPING);
      }
    });

    it("keeps the outer folders when it is nested deeper than the cap", () => {
      const names = Array.from({ length: 25 }, (_, i) => `f${i}`);
      const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>${names
        .map((name) => `<DT><H3>${name}</H3><DL>`)
        .join(
          "",
        )}<DT><A HREF="https://a.example/">A</A>${"</DL>".repeat(25)}<DT><A HREF="https://b.example/">B</A>`;
      const { bookmarks } = parse(html);
      expect(bookmarks[0]?.folders).toEqual(names.slice(0, MAX_TAGS_PER_CLIPPING));
      // The lists below the cap pushed and popped, so the top level is clean again.
      expect(bookmarks[1]?.folders).toEqual([]);
    });

    it("caps folders and TAGS together", () => {
      const tags = Array.from({ length: 30 }, (_, i) => `t${i}`).join(",");
      const { bookmarks } = parse(
        `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Work</H3><DL><DT><A HREF="https://a.example/" TAGS="${tags}">A</A></DL></DL>`,
      );
      expect(bookmarks[0]?.folders).toHaveLength(MAX_TAGS_PER_CLIPPING);
      expect(bookmarks[0]?.folders[0]).toBe("Work");
    });
  });

  it("keeps duplicates for the service to merge", () => {
    const { bookmarks } = parse(
      fileWith(`<A HREF="https://a.example/">One</A>`, `<A HREF="https://a.example/">Two</A>`),
    );
    expect(bookmarks.map((b) => b.title)).toEqual(["One", "Two"]);
  });
});

describe("serializeBookmarksHtml", () => {
  it("writes the Netscape header and a flat list", () => {
    const html = serializeBookmarksHtml([
      {
        url: "https://a.example/",
        title: "A",
        createdAt: "2023-11-14T22:13:20.000Z",
        tags: ["x", "y"],
      },
    ]);
    expect(html).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
    expect(html).toContain('charset=UTF-8">');
    expect(html).toContain("<TITLE>Bookmarks</TITLE>");
    expect(html).toContain("<H1>Bookmarks</H1>");
    expect(html).toContain(
      '<DT><A HREF="https://a.example/" ADD_DATE="1700000000" TAGS="x,y">A</A>',
    );
    expect(html.match(/<DL>/g)).toHaveLength(1);
  });

  it("escapes attributes and text", () => {
    const html = serializeBookmarksHtml([
      {
        url: 'https://a.example/?x=1&y="2"',
        title: `<script>alert('x')</script> & co`,
        createdAt: "2023-11-14T22:13:20.000Z",
        tags: ['say "hi"'],
      },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain('HREF="https://a.example/?x=1&amp;y=&quot;2&quot;"');
    expect(html).toContain('TAGS="say &quot;hi&quot;"');
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co");
  });

  it("omits what it cannot write", () => {
    const html = serializeBookmarksHtml([
      { url: "https://a.example/", title: "  ", createdAt: "not a date", tags: [] },
    ]);
    expect(html).toContain('<DT><A HREF="https://a.example/">https://a.example/</A>');
  });

  it("writes an empty list for no clippings", () => {
    expect(parse(serializeBookmarksHtml([]))).toEqual({ ok: true, bookmarks: [], skipped: [] });
  });

  describe("round trip", () => {
    it.each<[string, BookmarkToExport[]]>([
      [
        "plain clippings",
        [
          {
            url: "https://a.example/essay",
            title: "An essay",
            createdAt: "2024-03-01T10:20:30.000Z",
            tags: ["reading", "web"],
          },
          {
            url: "http://b.example/",
            title: "Old site",
            createdAt: "2001-09-09T01:46:40.000Z",
            tags: [],
          },
        ],
      ],
      [
        "special characters everywhere",
        [
          {
            url: "https://a.example/?q=a&b=c#frag",
            title: `Tom & "Jerry" <3 it's \u{1f680} é`,
            createdAt: "2024-03-01T10:20:30.999Z",
            tags: ["Q&A", `it's`, "日本語", "a<b>"],
          },
        ],
      ],
      [
        "a tag with a comma, which a comma-separated list cannot hold",
        [
          {
            url: "https://a.example/",
            title: "A",
            createdAt: "2024-03-01T10:20:30.000Z",
            tags: ["a,b"],
          },
        ],
      ],
    ])("keeps url, title, date and tags: %s", (_label, items) => {
      const { bookmarks } = parse(serializeBookmarksHtml(items));
      expect(bookmarks).toHaveLength(items.length);
      for (const [index, item] of items.entries()) {
        const back = bookmarks[index];
        expect(back?.url).toBe(item.url);
        expect(back?.title).toBe(item.title);
        // Second precision: the file holds unix seconds.
        expect(back?.addedAt).toEqual(fromUnixTime(getUnixTime(parseISO(item.createdAt))));
        expect(back?.folders).toEqual(item.tags.map((tag) => tag.replaceAll(",", " ")));
      }
    });
  });
});
