import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown.tsx";

const render = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }));

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
});
