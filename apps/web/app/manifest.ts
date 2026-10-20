import type { MetadataRoute } from "next";

import { APP_DESCRIPTION, APP_NAME } from "@/lib/pwa/app-identity.ts";
import { DEFAULT_PALETTE } from "@clippings/shared";
import tokens from "@clippings/ui/tokens.json";

// The colors the OS paints before the page loads (splash, launch title bar). Once it runs, the
// root layout's per-scheme `viewport.themeColor` takes over the title bar.
const light = tokens.palettes[DEFAULT_PALETTE].schemes.standard.light.roles;

const SHORTCUT_ICONS = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];

/** Served at `/manifest.webmanifest`. Its path has an extension, so the proxy lets it through. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    theme_color: light.surface,
    background_color: light.background,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-monochrome-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/narrow.png",
        sizes: "780x1688",
        type: "image/png",
        form_factor: "narrow",
        label: "Your clippings on a phone",
      },
      {
        src: "/screenshots/wide.png",
        sizes: "1440x900",
        type: "image/png",
        form_factor: "wide",
        label: "Your clippings on a computer",
      },
    ],
    // Android's share sheet. A GET needs no service worker; `/share` opens "New clipping" filled
    // in and saves nothing until Save, since any site can link there too.
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    // Both open the list; the page reads the parameter, acts on it and drops it.
    shortcuts: [
      {
        name: "New clipping",
        url: "/?new",
        icons: SHORTCUT_ICONS,
      },
      {
        name: "Search",
        url: "/?search",
        icons: SHORTCUT_ICONS,
      },
    ],
  };
}
