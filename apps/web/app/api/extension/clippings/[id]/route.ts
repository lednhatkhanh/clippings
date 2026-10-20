import { getExtensionApi } from "@/lib/extension/instance.ts";

/** The extension's CORS preflight. */
export function OPTIONS(request: Request) {
  return getExtensionApi().preflight(request);
}

/** Replaces the note on one of the caller's clippings, as the popup autosaves it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return getExtensionApi().updateNote(request, (await params).id);
}
