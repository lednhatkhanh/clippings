import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown.tsx";

const render = (source: string, links?: "default" | "web") =>
  renderToStaticMarkup(createElement(Markdown, { source, links }));

describe("Markdown", () => {
  it("shows raw HTML as text and never as markup", () => {
    const html = render(
      'Before <script>alert(1)</script> <img src=x onerror="alert(2)"> <iframe src="//evil.test"></iframe>',
    );

    expect(html).not.toMatch(/<script|<iframe|<img/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("leaves a javascript: link as plain text with no link to follow", () => {
    const html = render("[click me](javascript:alert(1)) and [data](data:text/html;base64,AAAA)");

    expect(html).not.toMatch(/javascript:|data:text/i);
    expect(html).not.toContain("<a");
    expect(html).toContain("click me");
  });

  it("opens ordinary links in a new tab without handing over the opener or referrer", () => {
    const html = render("[docs](https://example.com/docs)");

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("never loads an image: it becomes a link to it", () => {
    const html = render("![tracker](https://evil.test/pixel.gif)");

    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://evil.test/pixel.gif"');
  });

  it("formats what GitHub-flavoured Markdown adds: tables, task lists, strikethrough and code", () => {
    const html = render(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] open\n\n~~gone~~\n\n```ts\nconst x = 1;\n```",
    );

    expect(html).toContain("<table");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain("const x = 1;");
  });

  it('with links="web" keeps only http and https addresses as links', () => {
    const source =
      "[web](https://example.com/a) [plain](http://example.com/b) [mail](mailto:a@example.com) " +
      "[call](tel:+15555550100) [rel](/settings) [proto](//evil.test/x) [anchor](#top)";

    const html = render(source, "web");

    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('href="http://example.com/b"');
    expect(html).not.toMatch(/mailto:|tel:|href="\/settings"|evil\.test|href="#top"/);
    expect(html.match(/<a /g)).toHaveLength(2);
    for (const text of ["mail", "call", "rel", "proto", "anchor"]) expect(html).toContain(text);
    // The default still allows what it did.
    expect(render("[mail](mailto:a@example.com)")).toContain('href="mailto:a@example.com"');
  });
});
