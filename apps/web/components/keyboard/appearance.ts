import { shownAppearance, switchAppearance } from "@/components/settings/switch-appearance.ts";
import { oppositeTheme } from "@/lib/keyboard/shortcuts.ts";

/**
 * Switches light and dark on this device and saves it, as Settings and the command palette do:
 * `system` goes to the opposite of what shows now.
 */
export function toggleTheme() {
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  switchAppearance("theme", oppositeTheme(shownAppearance().theme, prefersDark));
}
