import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { DEFAULT_PALETTE, NO_FLASH_SCRIPT } from "@clippings/ui";
import tokens from "@clippings/ui/tokens.json";

import { AppShell } from "../components/app-shell";
import { mono, sans, serif } from "./fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: "Clippings",
  description: "Save pages, add notes, find them again.",
};

const paper = tokens.palettes[DEFAULT_PALETTE].schemes.standard;

export const viewport: Viewport = {
  colorScheme: "light dark",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: paper.light.roles.surface },
    { media: "(prefers-color-scheme: dark)", color: paper.dark.roles.surface },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The no-flash script sets data-theme, data-palette, data-contrast and data-density on
    // <html> before paint, so the server markup can't know them.
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
