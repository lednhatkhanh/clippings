import { describe, expect, it } from "vitest";

import { MAX_PAGE_TEXT, extractPage } from "./html-text";

describe("extractPage", () => {
  it("takes the title and the readable text, leaving out scripts, styles and navigation chrome", () => {
    const page = extractPage(`<!doctype html>
      <html><head>
        <title>  Small gardens &amp; big ideas | Example </title>
        <style>body { color: red }</style>
        <script>window.track("hello")</script>
      </head><body>
        <nav><a href="/">Home</a></nav>
        <article>
          <h1>Small gardens</h1>
          <p>They <em>reward</em> attention&hellip; and patience.</p>
          <p>Plant what you&#39;ll eat.</p>
        </article>
        <footer>Copyright</footer>
      </body></html>`);

    expect(page.title).toBe("Small gardens & big ideas | Example");
    expect(page.text).toBe(
      "Small gardens\nThey reward attention… and patience.\nPlant what you'll eat.",
    );
  });

  it("falls back to the whole body when there is no article or main", () => {
    const page = extractPage("<body><div>One</div><div>Two <b>words</b></div></body>");

    expect(page.title).toBeNull();
    expect(page.text).toBe("One\nTwo words");
  });

  it("cuts very long text", () => {
    const page = extractPage(`<body><p>${"word ".repeat(MAX_PAGE_TEXT)}</p></body>`);

    expect(page.text.length).toBeLessThanOrEqual(MAX_PAGE_TEXT);
  });

  it("copes with markup that never closes", () => {
    expect(() => extractPage("<html><body><p>Unclosed <b>bold <script>alert(1)")).not.toThrow();
  });
});
