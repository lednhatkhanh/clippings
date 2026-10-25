/** The seed palettes the theme is generated from. */
export const PALETTE_NAMES = [
  "olive",
  "ochre",
  "terracotta",
  "ink",
  "raspberry",
  "graphite",
] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];

export const DEFAULT_PALETTE: PaletteName = "olive";

/**
 * A user's appearance settings, as `<html>` carries them in data attributes. `system` means "no
 * attribute": `color-scheme: light dark` follows the OS theme and the generated CSS follows
 * `prefers-contrast`.
 */
export const APPEARANCE_VALUES = {
  theme: ["system", "light", "dark"],
  palette: PALETTE_NAMES,
  contrast: ["system", "standard", "medium", "high"],
  density: ["comfortable", "compact"],
} as const;

export type AppearanceKey = keyof typeof APPEARANCE_VALUES;
export const APPEARANCE_KEYS = Object.keys(APPEARANCE_VALUES) as AppearanceKey[];

export type Appearance = { [K in AppearanceKey]: (typeof APPEARANCE_VALUES)[K][number] };

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: "system",
  palette: DEFAULT_PALETTE,
  contrast: "system",
  density: "comfortable",
};

export const isAppearanceValue = <K extends AppearanceKey>(
  key: K,
  value: unknown,
): value is Appearance[K] => (APPEARANCE_VALUES[key] as readonly unknown[]).includes(value);

/** The known settings in `input` that hold an allowed value. Anything else is dropped. */
export function pickAppearance(input: unknown): Partial<Appearance> {
  const picked: Partial<Appearance> = {};
  if (typeof input !== "object" || input === null) return picked;
  for (const key of APPEARANCE_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (isAppearanceValue(key, value)) Object.assign(picked, { [key]: value });
  }
  return picked;
}
