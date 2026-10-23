import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { NextLinks } from "@/components/next-links.tsx";
import { ServiceWorker } from "@/components/service-worker.tsx";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/pwa/app-identity.ts";
import { FIRST_PAINT_STYLE, LAUNCH_SCREENS } from "@/lib/pwa/launch-screen.ts";
import { DEFAULT_PALETTE } from "@clippings/shared";
import { NO_FLASH_SCRIPT } from "@clippings/ui";
import tokens from "@clippings/ui/tokens.json";

import { mono, sans, serif } from "./fonts.ts";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
    startupImage: LAUNCH_SCREENS.map(({ url, media }) => ({ url, media })),
  },
  // Next.js writes `capable` as the standard `mobile-web-app-capable`; iOS reads launch screens
  // only for a web app that declares the Apple name.
  other: { "apple-mobile-web-app-capable": "yes" },
};

const defaults = tokens.palettes[DEFAULT_PALETTE].schemes.standard;

export const viewport: Viewport = {
  colorScheme: "light dark",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: defaults.light.roles.ground },
    { media: "(prefers-color-scheme: dark)", color: defaults.dark.roles.ground },
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
        <style dangerouslySetInnerHTML={{ __html: FIRST_PAINT_STYLE }} />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <NextLinks>{children}</NextLinks>
        <ServiceWorker />
      </body>
    </html>
  );
}
