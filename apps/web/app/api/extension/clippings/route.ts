import { getExtensionApi } from "@/lib/extension/instance.ts";

/** The extension's CORS preflight. */
export function OPTIONS(request: Request) {
  return getExtensionApi().preflight(request);
}

/** Saves the page the popup opened on, or finds it when it is already saved. */
export function POST(request: Request) {
  return getExtensionApi().save(request);
}
