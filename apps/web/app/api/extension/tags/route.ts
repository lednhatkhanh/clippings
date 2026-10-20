import { getExtensionApi } from "@/lib/extension/instance.ts";

/** The extension's CORS preflight. */
export function OPTIONS(request: Request) {
  return getExtensionApi().preflight(request);
}

/** Every tag the caller has, for the popup's tag picker. */
export function GET(request: Request) {
  return getExtensionApi().listTags(request);
}
