import { getExtensionApi } from "@/lib/extension/instance.ts";

/** The extension's CORS preflight. */
export function OPTIONS(request: Request) {
  return getExtensionApi().preflight(request);
}

/** The caller's palette, for the popup. */
export function GET(request: Request) {
  return getExtensionApi().settings(request);
}
