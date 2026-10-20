import * as z from "zod";

import { PALETTE_NAMES } from "./appearance.ts";
import { MAX_NOTE_LENGTH } from "./clipping.ts";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_CLIPPING, TAG_COLORS } from "./tag.ts";
import { parseWebUrl } from "./url.ts";

/**
 * The extension's REST API, under the web app's origin. It is also the OAuth resource the
 * extension's access tokens are issued for, so a token for it is good nowhere else.
 */
export const EXTENSION_API_PATH = "/api/extension";

/** The extension's id, fixed by the public key in its manifest; the web app trusts it. */
export const CLIPPINGS_EXTENSION_ID = "niennihgpnpplljbiaddgeoliojiffdc";

/** Longest URL the extension sends: well past any real page address, short of abuse. */
const MAX_URL_LENGTH = 8_192;

/** `POST /api/extension/clippings`: save the page, or find it when it is already saved. */
export const extensionSaveRequestSchema = z.object({
  url: z.string().min(1).max(MAX_URL_LENGTH),
});
export type ExtensionSaveRequest = z.infer<typeof extensionSaveRequestSchema>;

/**
 * `PATCH /api/extension/clippings/:id`: replace the clipping's note, its tags (by name, creating
 * new ones) or both.
 */
export const extensionUpdateRequestSchema = z
  .object({
    note: z.string().max(MAX_NOTE_LENGTH).optional(),
    tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_CLIPPING).optional(),
  })
  .refine(({ note, tags }) => note !== undefined || tags !== undefined);
export type ExtensionUpdateRequest = z.infer<typeof extensionUpdateRequestSchema>;

/** One of the user's tags, as the popup's tag picker offers it. */
export const extensionTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.enum(TAG_COLORS),
});

/** `GET /api/extension/tags`: every tag the user has, by name. */
export const extensionTagsResponseSchema = z.array(extensionTagSchema);

/**
 * `GET /api/extension/settings`: what the popup takes from the user's settings. Only the palette:
 * the popup follows the OS for light and dark.
 */
export const extensionSettingsSchema = z.object({ palette: z.enum(PALETTE_NAMES) });
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

/**
 * What the web app sends the extension (`chrome.runtime.sendMessage` from a Clippings page, which
 * the extension's `externally_connectable` lets through) when the user picks a palette, so the
 * popup opens in it next time without waiting for its own refresh.
 */
export const extensionPaletteMessageSchema = z.object({
  type: z.literal("palette"),
  palette: z.enum(PALETTE_NAMES),
});
export type ExtensionPaletteMessage = z.infer<typeof extensionPaletteMessageSchema>;

/** A clipping as the popup shows it. */
export const extensionClippingSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  note: z.string(),
  /** Defaults to none, for a server from before tags reached the extension. */
  tags: z.array(extensionTagSchema).default([]),
  /** ISO 8601. */
  createdAt: z.string(),
  /** The clipping's detail page in the web app. */
  link: z.url(),
});
export type ExtensionClipping = z.infer<typeof extensionClippingSchema>;

export const extensionSaveResponseSchema = z.object({
  status: z.enum(["created", "existing"]),
  clipping: extensionClippingSchema,
});
export type ExtensionSaveResponse = z.infer<typeof extensionSaveResponseSchema>;

/**
 * Why the extension's sign-in was refused, in the `error_description` of the `access_denied`
 * error the authorization server sends back to it.
 */
export type ExtensionSignInError = "not_allowlisted" | "denied";

/** Why the API refused a request, in the body of a 4xx answer. */
export const EXTENSION_API_ERRORS = [
  "invalid_token",
  "invalid_request",
  "invalid_url",
  "not_found",
  "not_allowlisted",
] as const;
export type ExtensionApiError = (typeof EXTENSION_API_ERRORS)[number];

/** Hosts of extension stores: browsers keep extensions off them, so their pages aren't saved. */
const STORE_HOSTS = new Set([
  "chrome.google.com",
  "chromewebstore.google.com",
  "microsoftedge.microsoft.com",
  "addons.mozilla.org",
]);

/**
 * Whether the extension offers to save the page at this address. Browser-internal pages
 * (`chrome://`, `about:`, other extensions), local files and extension stores are not: the answer
 * comes without a network call.
 */
export function isSaveablePage(address: string | undefined): boolean {
  if (!address || !/^https?:\/\//i.test(address)) return false;
  const parsed = parseWebUrl(address);
  if (!parsed) return false;
  const { hostname, pathname } = new URL(parsed.url);
  if (hostname === "chrome.google.com") return !pathname.startsWith("/webstore");
  if (hostname === "microsoftedge.microsoft.com") return !pathname.startsWith("/addons");
  return !STORE_HOSTS.has(hostname);
}
