import { defineConfig } from "wxt";

/**
 * The public half of the key that pins the extension's id (`CLIPPINGS_EXTENSION_ID` in
 * `@clippings/shared`), so an unpacked build and the CI zip both get the id the web app trusts
 * for sign-in and CORS. A store listing assigns its own id; the web app's `EXTENSION_IDS` adds it.
 */
const MANIFEST_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwLGVWnNpKFhnY5d1lRBloc50yYuDcCaVezfzhqrhapnX7UGHHFJ0vA0dH20bF92LpWUfUQ4KPKIGbSH3ESsV/6aRQXi9iCkttQAsQEFla82QH2k+6zMi9/mRvh4cejE708NXoR+DJHnu5hY/kNLXD9YHRIlOfWM11x/VUNE2F88L7+lpnxgYo6RREvgKDNz3ygZsC3kX7T5qEIgD4rCvLG7kmCv2Idfwzm4KI1ZQIoutxtQVdzwXB9sWtW9lECTTFJD0ygOcSL9O6PnkYApRlI6DUHOJDdUhEGHGrbkHJradl7pA00e3wFz4zvsDIjrabSqgLALLRav6ANorg0PxnQIDAQAB";

/** The Clippings web app the extension signs in to and saves through. */
const CLIPPINGS_ORIGIN = new URL(process.env.CLIPPINGS_ORIGIN || "http://localhost:3100").origin;

export default defineConfig({
  manifest: {
    name: "Clippings",
    description: "Save the page you're on to Clippings, with a note.",
    key: MANIFEST_KEY,
    // activeTab: the current tab's address when the toolbar button opens the popup, without
    // access to every tab. identity: the sign-in window. storage: the sign-in, kept on this device,
    // and the palette, synced. scripting: the page's selection, under that activeTab grant.
    permissions: ["activeTab", "identity", "storage", "scripting"],
    // Only the Clippings API; the service worker makes every call.
    host_permissions: [`${CLIPPINGS_ORIGIN}/*`],
    // Clippings pages may tell the extension the palette the user picks; nothing else may.
    externally_connectable: { matches: [`${CLIPPINGS_ORIGIN}/*`] },
  },
  zip: { artifactTemplate: "clippings-extension-{{version}}-{{browser}}.zip" },
  vite: () => ({
    define: { "import.meta.env.CLIPPINGS_ORIGIN": JSON.stringify(CLIPPINGS_ORIGIN) },
    build: {
      rollupOptions: {
        // The design system marks its React Aria components "use client" for Next.js; the popup
        // is all client, so dropping the directive is right.
        onwarn(warning, warn) {
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
      },
    },
  }),
});
