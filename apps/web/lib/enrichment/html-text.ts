import type { FetchedPage } from "@clippings/db";

/** Most text of a page that goes on to the summarizer, in characters. */
export const MAX_PAGE_TEXT = 20_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const collapse = (text: string) => decodeEntities(text).replace(/\s+/g, " ").trim();

/** The inside of the first `<tag>…</tag>`, or to the end of the document when it never closes. */
function firstElement(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)(?:</${tag}\\s*>|$)`, "i").exec(html);
  return match ? (match[1] ?? null) : null;
}

/**
 * A page's title and readable text from its HTML. Deliberately simple: the summarizer copes with
 * noise, so this only drops what is never prose (scripts, styles, navigation) and keeps the main
 * content when the page marks one.
 */
export function extractPage(html: string): FetchedPage {
  const title = collapse(firstElement(html, "title") ?? "") || null;

  const withoutNoise = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(
      /<(script|style|noscript|svg|template|head)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1\s*>|$)/gi,
      "",
    );
  const content =
    firstElement(withoutNoise, "article") ??
    firstElement(withoutNoise, "main") ??
    firstElement(withoutNoise, "body") ??
    withoutNoise;

  const text = content
    .replace(/<(nav|footer|aside|form)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(
      /<\/?(?:p|div|br|li|ul|ol|h[1-6]|section|article|main|header|blockquote|pre|tr|table|figure|figcaption)(?:\s[^>]*)?\/?>/gi,
      "\n",
    )
    .replace(/<[^>]*>?/g, "")
    .split("\n")
    .map(collapse)
    .filter(Boolean)
    .join("\n");

  return { title, text: text.slice(0, MAX_PAGE_TEXT) };
}
