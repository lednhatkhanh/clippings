import type { PaletteName } from "@clippings/shared";

export interface PaletteSeed {
  /** Source color the Tonal Spot scheme is built from. */
  seed: string;
  /** Warm neutral override: hue 72–88, chroma 8–9. Neutral variant is chroma + 4. */
  neutral: { hue: number; chroma: number };
}

export const PALETTES: Record<PaletteName, PaletteSeed> = {
  olive: { seed: "#7C7A4E", neutral: { hue: 88, chroma: 8 } },
  ochre: { seed: "#E6B800", neutral: { hue: 85, chroma: 9 } },
  terracotta: { seed: "#E07A2E", neutral: { hue: 72, chroma: 9 } },
  ink: { seed: "#3F5F8A", neutral: { hue: 80, chroma: 8 } },
};

/** Names match `data-contrast`; levels are what material-color-utilities takes. */
export const CONTRAST_LEVELS = { standard: 0, medium: 0.5, high: 1 } as const;
export type ContrastName = keyof typeof CONTRAST_LEVELS;
export const CONTRAST_NAMES = Object.keys(CONTRAST_LEVELS) as ContrastName[];

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export const TAG_NAMES = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type TagName = (typeof TAG_NAMES)[number];

/** Design hues, before harmonizing to a palette seed. */
export const TAG_HUES: Record<TagName, number> = {
  red: 27,
  orange: 60,
  amber: 91,
  green: 146,
  teal: 193,
  blue: 255,
  violet: 305,
  pink: 355,
};

export const TAG_CHROMA = 36;

/** HCT tones for a tag's container, on-container text and 8px dot. */
export const TAG_TONES: Record<
  ContrastName,
  Record<Mode, { container: number; onContainer: number; dot: number }>
> = {
  standard: {
    light: { container: 90, onContainer: 10, dot: 40 },
    dark: { container: 30, onContainer: 90, dot: 80 },
  },
  medium: {
    light: { container: 92, onContainer: 6, dot: 35 },
    dark: { container: 26, onContainer: 93, dot: 85 },
  },
  high: {
    light: { container: 95, onContainer: 0, dot: 30 },
    dark: { container: 20, onContainer: 98, dot: 90 },
  },
};
