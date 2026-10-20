import { getExtensionApi } from "@/lib/extension/instance.ts";

/** The extension's CORS preflight. */
export function OPTIONS(request: Request) {
  return getExtensionApi().preflight(request);
}

/** Replaces the note or the tags on one of the caller's clippings, as the popup autosaves them. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return getExtensionApi().update(request, (await params).id);
}
