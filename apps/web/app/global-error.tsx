"use client";

import { DEFAULT_PALETTE } from "@clippings/shared";
import tokens from "@clippings/ui/tokens.json";

const { light, dark } = tokens.palettes[DEFAULT_PALETTE].schemes.standard;

/** One color role in both schemes, as the generated theme writes it. */
const role = (name: keyof typeof light.roles) =>
  `light-dark(${light.roles[name]}, ${dark.roles[name]})`;

/*
 * The root layout failed, so neither the app's stylesheet nor its fonts may be there. This page
 * brings its own few tokens, taken from the default palette, and follows the OS color scheme.
 */
const STYLES = `
  :root {
    color-scheme: light dark;
    --ground: ${role("ground")};
    --paper: ${role("paper")};
    --ink: ${role("ink")};
    --ink-muted: ${role("ink-muted")};
    --line: ${role("line")};
    --accent: ${role("accent")};
    --accent-top: ${role("accent-top")};
    --on-accent: ${role("on-accent")};
    --accent-ink: ${role("accent-ink")};
  }
  body {
    margin: 0;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1rem;
    box-sizing: border-box;
    background: var(--ground);
    color: var(--ink);
    font-family: system-ui, sans-serif;
    text-align: center;
  }
  main {
    box-sizing: border-box;
    width: 100%;
    max-width: 30rem;
    padding: 3rem 1.5rem;
    border-radius: 1.5rem;
    background: var(--paper);
    box-shadow: 0 0 0 1px var(--line), 0 12px 24px -8px var(--line);
  }
  h1 {
    margin: 0 0 0.75rem;
    font-family: Georgia, serif;
    font-size: 1.5rem;
    line-height: 1.875rem;
    font-weight: 500;
  }
  p {
    margin: 0 0 1.5rem;
    color: var(--ink-muted);
    font-size: 1rem;
    line-height: 1.5rem;
  }
  button {
    min-height: 2.75rem;
    padding: 0 1.5rem;
    border: 0;
    border-radius: 0.75rem;
    background: linear-gradient(180deg, var(--accent-top), var(--accent));
    color: var(--on-accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
`;

/** Stands in for the whole document when the root layout itself throws. */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong · Clippings</title>
        {/* oxlint-disable-next-line shadcn/no-inline-styles -- the app stylesheet may be what failed */}
        <style>{STYLES}</style>
      </head>
      <body>
        <main>
          <h1>Something went wrong.</h1>
          <p>Clippings couldn&apos;t be shown. Try again in a moment.</p>
          <button type="button" onClick={retry}>
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
