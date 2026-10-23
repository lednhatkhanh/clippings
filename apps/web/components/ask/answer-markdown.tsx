"use client";

import type { ComponentProps } from "react";
import { Streamdown, type Components, type ExtraProps } from "streamdown";

import { citeNumber } from "./answer.ts";

/** A link in the answer: a citation marker (`#cite-<number>`), or a link the model wrote. */
function AnswerLink({ href, children }: ComponentProps<"a"> & ExtraProps) {
  const cite = citeNumber(href);
  if (cite !== null) {
    return (
      <sup className="mx-0.5 typescale-label-sm text-ink-muted">
        <span className="sr-only">Source </span>
        {cite}
      </sup>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-ink underline underline-offset-2"
    >
      {children}
    </a>
  );
}

// Every element the answer may hold, on the design system's type and colors. Streamdown's own
// classes are left out: they assume shadcn's variables, and Tailwind doesn't scan node_modules.
// Headings start at h3, under the page's h1 and the answer's own sections.
const components: Components = {
  a: AnswerLink,
  // Never an image: the answer is written from saved pages, and an image URL a page slipped into
  // it would load with no click, carrying whatever the URL holds. Its alt text stands in.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1.5 ps-5">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1.5 ps-5">{children}</ol>,
  li: ({ children }) => <li className="ps-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => <h3 className="typescale-title-md">{children}</h3>,
  h2: ({ children }) => <h3 className="typescale-title-md">{children}</h3>,
  h3: ({ children }) => <h4 className="typescale-title-sm">{children}</h4>,
  h4: ({ children }) => <h4 className="typescale-title-sm">{children}</h4>,
  h5: ({ children }) => <h4 className="typescale-title-sm">{children}</h4>,
  h6: ({ children }) => <h4 className="typescale-title-sm">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="border-s-2 border-line ps-3 text-ink-muted">{children}</blockquote>
  ),
  hr: () => <hr className="border-line" />,
  inlineCode: ({ children }) => (
    <code className="rounded-sm bg-ground-sunk px-1 font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-ground-sunk p-3 typescale-body-sm font-mono">
      {children}
    </pre>
  ),
  code: ({ children }) => <code>{children}</code>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse typescale-body-md">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line-strong px-2 py-1.5 text-start font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-2 py-1.5">{children}</td>,
};

/**
 * The answer's Markdown, rendered as it streams: Streamdown closes the bold, list or link a
 * partial answer leaves open, so half-written syntax never shows. Loaded on its own chunk (see
 * `AskForm`), since a Markdown parser is most of its weight.
 */
export function AnswerMarkdown({ markdown, streaming }: { markdown: string; streaming: boolean }) {
  return (
    <Streamdown
      className="flex flex-col gap-3 typescale-reading"
      components={components}
      isAnimating={streaming}
      controls={false}
      // Raw HTML in the answer shows as nothing, for the same reason as images.
      skipHtml
      // Links open in a new tab from `AnswerLink`, so Streamdown's confirmation dialog is off.
      linkSafety={{ enabled: false }}
    >
      {markdown}
    </Streamdown>
  );
}
