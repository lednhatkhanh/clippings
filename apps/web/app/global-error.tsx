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
    --surface: ${role("surface")};
    --on-surface: ${role("on-surface")};
    --on-surface-variant: ${role("on-surface-variant")};
    --primary: ${role("primary")};
    --on-primary: ${role("on-primary")};
    --secondary: ${role("secondary")};
  }
  body {
    margin: 0;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1rem;
    box-sizing: border-box;
    background: var(--surface);
    color: var(--on-surface);
    font-family: system-ui, sans-serif;
    text-align: center;
  }
  h1 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
    line-height: 2rem;
    font-weight: 400;
  }
  p {
    margin: 0 0 1.5rem;
    color: var(--on-surface-variant);
    font-size: 1rem;
    line-height: 1.5rem;
  }
  button {
    min-height: 3rem;
    padding: 0 1.5rem;
    border: 0;
    border-radius: 9999px;
    background: var(--primary);
    color: var(--on-primary);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  button:focus-visible {
    outline: 3px solid var(--secondary);
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
