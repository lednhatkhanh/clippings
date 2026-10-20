import { getAuth } from "@/lib/auth/auth.ts";
import { getClippings } from "@/lib/clippings/service.ts";

import { createExtensionApi, type ExtensionApi } from "./api.ts";
import { extensionResourceUrl, parseExtensionIds } from "./origins.ts";

let api: ExtensionApi | undefined;

/** The extension API (see `createExtensionApi`). Built on first use, so `next build` needs no secrets. */
export function getExtensionApi(): ExtensionApi {
  return (api ??= createExtensionApi({
    auth: getAuth(),
    clippings: getClippings(),
    resource: extensionResourceUrl(),
    allowedEmails: process.env.ALLOWED_EMAILS,
    extensionIds: parseExtensionIds(process.env.EXTENSION_IDS),
  }));
}
