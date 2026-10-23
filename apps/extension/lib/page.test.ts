import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { MAX_PAGE_TEXT, MAX_TITLE_LENGTH } from "@clippings/shared";

import { pageFrom, READ_TIMEOUT_MS, readPage } from "./page.ts";

const URL = "https://example.com/essay";
const raw = (text: string, title = "Essay", url = URL) => ({ url, title, text });

describe("the page as the server takes it", () => {
  it.each([
    ["plain text", "One\nTwo", "One\nTwo"],
    ["CRLF and lone CR line breaks", "One\r\nTwo\rThree", "One\nTwo\nThree"],
    ["whitespace around lines", "  One \n\t Two\t", "One\nTwo"],
    ["runs of blank lines as one", "One\n\n \n\n\nTwo", "One\n\nTwo"],
    ["blank lines at the ends", "\n\n  One\n\n", "One"],
    ["NUL characters, which Postgres rejects", "On\u0000e\n\u0000\nTwo", "One\n\nTwo"],
  ])("normalises %s", (_, text, expected) => {
    expect(pageFrom(raw(text), URL)?.text).toBe(expected);
  });

  it.each([
    ["nothing", ""],
    ["only whitespace", " \n\r\n\t "],
  ])("is undefined for a page with %s to read", (_, text) => {
    expect(pageFrom(raw(text), URL)).toBeUndefined();
  });

  it("cuts the text to what the server takes, trimmed", () => {
    const page = pageFrom(raw(`${"a".repeat(MAX_PAGE_TEXT - 2)}  b${"c".repeat(50)}`), URL);

    expect(page?.text).toBe(`${"a".repeat(MAX_PAGE_TEXT - 2)}`);
    expect(pageFrom(raw("x".repeat(MAX_PAGE_TEXT + 100)), URL)?.text).toHaveLength(MAX_PAGE_TEXT);
  });

  it("doesn't end the cut text on half of a surrogate pair", () => {
    const text = `${"a".repeat(MAX_PAGE_TEXT - 1)}😀`;

    expect(pageFrom(raw(text), URL)?.text).toBe("a".repeat(MAX_PAGE_TEXT - 1));
  });

  it.each([
    ["trims the title", "  Essay \n", "Essay"],
    ["makes an empty title null", "   ", null],
    ["drops NUL characters from the title", "Es\u0000say", "Essay"],
    ["cuts a long title", "t".repeat(MAX_TITLE_LENGTH + 20), "t".repeat(MAX_TITLE_LENGTH)],
  ])("%s", (_, title, expected) => {
    expect(pageFrom(raw("Text", title), URL)?.title).toBe(expected);
  });

  it("is undefined when the tab shows another page than the one being saved", () => {
    expect(pageFrom(raw("Text", "Other", "https://example.com/next"), URL)).toBeUndefined();
    expect(pageFrom(raw("Text", "Other", "not a url"), URL)).toBeUndefined();
  });

  it("takes the same page by another spelling of its address", () => {
    expect(pageFrom(raw("Text", "Essay", `${URL}#section`), URL)).toEqual({
      title: "Essay",
      text: "Text",
    });
  });
});

describe("reading the page in the tab", () => {
  const executeScript = vi.fn();

  beforeEach(() => {
    fakeBrowser.reset();
    executeScript.mockReset();
    Object.assign(fakeBrowser, { scripting: { executeScript } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers the normalised page", async () => {
    executeScript.mockResolvedValue([{ result: raw("  Hello \r\n\r\n\r\nWorld", " Essay ") }]);

    expect(await readPage(7, URL)).toEqual({ title: "Essay", text: "Hello\n\nWorld" });
  });

  it("gives up on a tab that doesn't answer within the timeout", async () => {
    vi.useFakeTimers();
    executeScript.mockReturnValue(new Promise(() => {}));
    let answer: unknown = "pending";
    void readPage(7, URL).then((page) => (answer = page));

    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(answer).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBeUndefined();
  });

  it("answers as soon as the tab does, without waiting out the timeout", async () => {
    vi.useFakeTimers();
    executeScript.mockResolvedValue([{ result: raw("Text") }]);

    expect(await readPage(7, URL)).toEqual({ title: "Essay", text: "Text" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [
      "the tab can't be scripted",
      () => executeScript.mockRejectedValue(new Error("Cannot access")),
    ],
    ["there is no result", () => executeScript.mockResolvedValue([])],
    ["the result isn't a page", () => executeScript.mockResolvedValue([{ result: "text" }])],
    [
      "the tab has navigated",
      () => executeScript.mockResolvedValue([{ result: raw("Text", "Next", `${URL}/next`) }]),
    ],
  ])("is undefined when %s", async (_, setUp) => {
    setUp();

    expect(await readPage(7, URL)).toBeUndefined();
  });
});
