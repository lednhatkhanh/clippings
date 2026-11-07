import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Headings sit one level lower than the Markdown wrote them: the page has its own title, so a
 * note's `#` is a section heading, and `######` stays the lowest level there is.
 */
const heading = (Tag: "h2" | "h3" | "h4" | "h5" | "h6", className: string) =>
  function Heading({ children }: { children?: ReactNode }) {
    return <Tag className={className}>{children}</Tag>;
  };

/** Code with a language or more than a line is a block; the `pre` around it carries the style. */
const isBlockCode = (className: string | undefined, children: ReactNode) =>
  Boolean(className?.startsWith("language-")) ||
  (typeof children === "string" && children.includes("\n"));

/**
 * Markdown elements as the design system styles them. Raw HTML in the source is never rendered
 * (react-markdown shows it as text, and `rehype-raw` is deliberately not used), a link whose
 * address react-markdown refuses (`javascript:` and the like) is plain text, and an image is a link
 * to it: a note written over MCP must not make the page load anything from anywhere.
 */
const components: Components = {
  h1: heading("h2", "typescale-title-lg mt-2"),
  h2: heading("h3", "typescale-title-md mt-2"),
  h3: heading("h4", "typescale-title-sm mt-1"),
  h4: heading("h5", "typescale-label-lg mt-1"),
  h5: heading("h6", "typescale-label-lg text-ink-muted"),
  h6: heading("h6", "typescale-label-md text-ink-muted"),
  p: ({ children }) => <p className="text-pretty">{children}</p>,
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-ink underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-ink underline underline-offset-2"
      >
        {alt || src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
  ul: ({ children }) => <ul className="ms-6 flex list-disc flex-col gap-1">{children}</ul>,
  ol: ({ children }) => <ol className="ms-6 flex list-decimal flex-col gap-1">{children}</ol>,
  li: ({ children }) => <li className="text-pretty">{children}</li>,
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      // GitHub task lists: shown, not editable.
      <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="me-2" />
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="flex flex-col gap-3 border-s-2 border-line-strong ps-4 text-ink-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-line" />,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-ground-sunk p-3 typescale-body-md">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    isBlockCode(className, children) ? (
      <code className="font-mono">{children}</code>
    ) : (
      <code className="rounded-xs bg-ground-sunk px-1 typescale-body-md font-mono">{children}</code>
    ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse typescale-body-md">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th
      scope="col"
      align={style?.textAlign as "left" | "right" | "center" | undefined}
      className="border border-line px-3 py-1.5 text-start typescale-label-lg"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      align={style?.textAlign as "left" | "right" | "center" | undefined}
      className="border border-line px-3 py-1.5"
    >
      {children}
    </td>
  ),
};

/**
 * GitHub-flavoured Markdown (tables, task lists, strikethrough, autolinks, code) as formatted
 * text, for notes now and for briefs, lessons and topic pages later. A plain component with no
 * client code: rendered in a Server Component it adds nothing to the page's JavaScript.
 *
 * The source is untrusted (a client can write a note over MCP): see `components` for what is
 * never rendered.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 typescale-body-lg wrap-anywhere">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
