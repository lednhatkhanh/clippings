import { getExtensionApi } from "@/lib/extension/instance.ts";

/** The extension's CORS preflight. */
export function OPTIONS(request: Request) {
  return getExtensionApi().preflight(request);
}

/** Whether the page in a tab is saved, when the user opted in to seeing it on the toolbar icon. */
export function POST(request: Request) {
  return getExtensionApi().lookup(request);
}
