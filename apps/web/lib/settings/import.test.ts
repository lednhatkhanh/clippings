import { describe, expect, it } from "vitest";

import { MAX_BOOKMARKS_FILE_BYTES } from "@clippings/shared";

import {
  bookmarksFileProblem,
  describeImported,
  describePending,
  describePreview,
  parseBookmarksUpload,
} from "./import.ts";

const BOOKMARKS = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><H3>Reading</H3>
  <DL><p>
    <DT><A HREF="https://example.com/a" ADD_DATE="1700000000">A</A>
    <DT><A HREF="javascript:void(0)">Bookmarklet</A>
  </DL><p>
</DL><p>`;

function upload(text: string, size = text.length) {
  return { size, text: () => Promise.resolve(text) };
}

describe("bookmarksFileProblem", () => {
  it.each([
    ["empty", 0, "That file is empty."],
    [
      "over the limit",
      MAX_BOOKMARKS_FILE_BYTES + 1,
      `That file is too large. Bookmark files up to ${MAX_BOOKMARKS_FILE_BYTES / (1024 * 1024)} MB can be imported.`,
    ],
    ["at the limit", MAX_BOOKMARKS_FILE_BYTES, null],
    ["small", 1200, null],
  ])("%s", (_name, size, expected) => {
    expect(bookmarksFileProblem({ size })).toBe(expected);
  });
});

describe("parseBookmarksUpload", () => {
  it("returns the bookmarks and counts the links that are not web pages", async () => {
    const result = await parseBookmarksUpload(upload(BOOKMARKS));
    expect(result).toMatchObject({ ok: true, notWeb: 1 });
    if (!result.ok) return;
    expect(result.bookmarks.map((bookmark) => [bookmark.url, bookmark.folders])).toEqual([
      ["https://example.com/a", ["Reading"]],
    ]);
  });

  it("refuses an oversized file without reading it", async () => {
    let read = false;
    const result = await parseBookmarksUpload({
      size: MAX_BOOKMARKS_FILE_BYTES + 1,
      text: () => {
        read = true;
        return Promise.resolve("");
      },
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("too large") });
    expect(read).toBe(false);
  });

  it("says plainly when the file is not a bookmarks file", async () => {
    const result = await parseBookmarksUpload(upload("<html><body>Hello</body></html>"));
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("doesn't look like a bookmarks file"),
    });
  });
});

describe("describePreview", () => {
  it.each([
    [{ willImport: 12, alreadySaved: 0, skipped: 0 }, "12 bookmarks will be imported."],
    [{ willImport: 1, alreadySaved: 0, skipped: 0 }, "1 bookmark will be imported."],
    [
      { willImport: 1200, alreadySaved: 3, skipped: 1 },
      "1,200 bookmarks will be imported. 3 already saved. 1 link is skipped (not web pages or unusable).",
    ],
    [
      { willImport: 0, alreadySaved: 5, skipped: 2 },
      "No new bookmarks to import. 5 already saved. 2 links are skipped (not web pages or unusable).",
    ],
  ])("%j", (preview, expected) => {
    expect(describePreview(preview)).toBe(expected);
  });
});

describe("describeImported", () => {
  it.each([
    [{ created: 1, existing: 0, skipped: 0, pending: 1 }, "Imported 1 clipping."],
    [
      { created: 40, existing: 2, skipped: 3, pending: 40 },
      "Imported 40 clippings. 2 already saved. 3 links were skipped.",
    ],
    [
      { created: 0, existing: 4, skipped: 1, pending: 0 },
      "Nothing new was imported. 4 already saved. 1 link was skipped.",
    ],
  ])("%j", (done, expected) => {
    expect(describeImported(done)).toBe(expected);
  });
});

describe("describePending", () => {
  it("says nothing when no import is waiting", () => {
    expect(describePending(0)).toBeNull();
  });

  it("counts what waits and says a large import is read over days", () => {
    expect(describePending(1)).toMatch(/^1 imported clipping is waiting to be read\./);
    expect(describePending(2500)).toMatch(
      /^2,500 imported clippings are waiting to be read\. .*several days/,
    );
  });
});
