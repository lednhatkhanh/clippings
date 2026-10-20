import * as z from "zod";

import { MAX_NOTE_LENGTH } from "./clipping.ts";
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

/** `PATCH /api/extension/clippings/:id`: replace the clipping's note. */
export const extensionNoteRequestSchema = z.object({
  note: z.string().max(MAX_NOTE_LENGTH),
});
export type ExtensionNoteRequest = z.infer<typeof extensionNoteRequestSchema>;

/**
 * `POST /api/extension/lookup`: whether the user has saved the page, for the toolbar icon. The
 * extension only asks when the user turned on "Show when a page is already saved", and sends the
 * page's normalized address (no fragment), in the body so it stays out of request logs.
 */
export const extensionLookupRequestSchema = z.object({
  url: z.string().min(1).max(MAX_URL_LENGTH),
});
export type ExtensionLookupRequest = z.infer<typeof extensionLookupRequestSchema>;

export const extensionLookupResponseSchema = z.object({ saved: z.boolean() });
export type ExtensionLookupResponse = z.infer<typeof extensionLookupResponseSchema>;

/** A clipping as the popup shows it. */
export const extensionClippingSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  note: z.string(),
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
