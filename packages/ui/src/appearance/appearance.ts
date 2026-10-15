import { DEFAULT_PALETTE, PALETTE_NAMES } from "../theme/palettes";

/**
 * Appearance settings that live on `<html>` as data attributes. `system` means "no attribute":
 * `color-scheme: light dark` follows the OS theme and the generated CSS follows
 * `prefers-contrast`.
 */
export const APPEARANCE_VALUES = {
  theme: ["system", "light", "dark"],
  palette: [...PALETTE_NAMES],
  contrast: ["system", "standard", "medium", "high"],
  density: ["comfortable", "compact"],
} as const;

export type AppearanceKey = keyof typeof APPEARANCE_VALUES;

export const APPEARANCE_DEFAULTS: { [K in AppearanceKey]: (typeof APPEARANCE_VALUES)[K][number] } =
  {
    theme: "system",
    palette: DEFAULT_PALETTE,
    contrast: "system",
    density: "comfortable",
  };

export const APPEARANCE_STORAGE_KEYS: Record<AppearanceKey, string> = {
  theme: "clippings.theme",
  palette: "clippings.palette",
  contrast: "clippings.contrast",
  density: "clippings.density",
};

/**
 * Inline script for `<head>`: reads local storage and sets the attributes before first paint.
 * Written as a string, not a stringified function, so bundler transforms can't change it. It
 * never throws: private windows and blocked storage fall back to the defaults.
 */
export const NO_FLASH_SCRIPT = `(function(){var root=document.documentElement;var keys=${JSON.stringify(
  APPEARANCE_STORAGE_KEYS,
)};var values=${JSON.stringify(APPEARANCE_VALUES)};var defaults=${JSON.stringify(
  APPEARANCE_DEFAULTS,
)};Object.keys(keys).forEach(function(name){var value=defaults[name];try{var stored=localStorage.getItem(keys[name]);if(stored&&values[name].indexOf(stored)!==-1){value=stored}}catch(e){}if(value==="system"){root.removeAttribute("data-"+name)}else{root.setAttribute("data-"+name,value)}})})();`;
