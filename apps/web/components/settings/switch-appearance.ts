import { saveAppearanceAction } from "@/app/(app)/settings/actions.ts";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  pickAppearance,
  type Appearance,
} from "@clippings/shared";
import { applyAppearance, toasts, transitionAppearance } from "@clippings/ui";

/** The appearance on screen, read from `<html>`, where a missing attribute means `system`. */
export function shownAppearance(): Appearance {
  const root = document.documentElement;
  const shown = Object.fromEntries(
    APPEARANCE_KEYS.map((key) => [key, root.getAttribute(`data-${key}`) ?? "system"]),
  );
  return { ...APPEARANCE_DEFAULTS, ...pickAppearance(shown) };
}

/** What the command palette and the keyboard switch on this device. */
export type Switchable = "theme" | "palette";

/**
 * Switches mode or palette on this device and saves it, as Settings does. A failed save puts the
 * old value back, unless something else has been picked since.
 */
export function switchAppearance<K extends Switchable>(key: K, value: Appearance[K]) {
  const shown = shownAppearance();
  const previous = shown[key];
  if (previous === value) return;
  transitionAppearance(() => applyAppearance({ ...shown, [key]: value }));

  saveAppearanceAction({ [key]: value }).catch(() => {
    const now = shownAppearance();
    if (now[key] === value) {
      transitionAppearance(() => applyAppearance({ ...now, [key]: previous }));
    }
    toasts.show({ message: "Couldn't save that setting. Try again." });
  });
}
