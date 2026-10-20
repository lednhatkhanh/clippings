import { saveAppearanceAction } from "@/app/(app)/settings/actions.ts";
import { sharePaletteWithExtension } from "@/lib/extension/share-palette.ts";
import type { Appearance } from "@clippings/shared";

/**
 * Saves the appearance settings the user changed. Once a new palette is saved, the extension is
 * told it too, so its popup opens in it.
 */
export async function saveAppearance(changes: Partial<Appearance>): Promise<void> {
  await saveAppearanceAction(changes);
  if (changes.palette) sharePaletteWithExtension(changes.palette);
}
