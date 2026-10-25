import type { PaletteName } from "@clippings/shared";

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

/** Names match `data-contrast`. */
export const CONTRAST_NAMES = ["standard", "medium", "high"] as const;
export type ContrastName = (typeof CONTRAST_NAMES)[number];

export interface PaletteSeed {
  /** The accent: its hue and chroma make every accent role. */
  seed: string;
  /**
   * HCT tone of the accent fill (filled buttons, the switch track) per mode. A light fill carries
   * dark text, a dark one white text, whichever reads better on it.
   */
  fill: Record<Mode, number>;
  /** The warm neutral the paper, ground and ink are made of. */
  neutral: { hue: number; chroma: number };
}

export const PALETTES: Record<PaletteName, PaletteSeed> = {
  olive: { seed: "#5A7656", fill: { light: 47, dark: 76 }, neutral: { hue: 96, chroma: 5 } },
  ochre: { seed: "#E2AE1C", fill: { light: 73, dark: 74 }, neutral: { hue: 92, chroma: 5 } },
  terracotta: { seed: "#BF5629", fill: { light: 48, dark: 70 }, neutral: { hue: 84, chroma: 5 } },
  ink: { seed: "#3E5E8A", fill: { light: 40, dark: 78 }, neutral: { hue: 90, chroma: 5 } },
  raspberry: { seed: "#BD0F72", fill: { light: 41.8, dark: 72 }, neutral: { hue: 40, chroma: 4 } },
  // Near-black on near-white, inverted in dark mode; a trace of chroma keeps it off pure grey.
  graphite: { seed: "#2D2F33", fill: { light: 20, dark: 88 }, neutral: { hue: 90, chroma: 1.5 } },
};

/** Paper is the neutral at this share of its chroma, so cards read whiter than the ground. */
export const PAPER_CHROMA_SHARE = 0.5;

/** HCT tones of the neutral roles. Each contrast level pulls ink further from paper. */
export const NEUTRAL_TONES: Record<
  ContrastName,
  Record<
    Mode,
    {
      ground: number;
      groundSunk: number;
      paper: number;
      paperShade: number;
      ink: number;
      inkMuted: number;
      inkFaint: number;
    }
  >
> = {
  standard: {
    light: {
      ground: 94,
      groundSunk: 91,
      paper: 98.5,
      paperShade: 96.5,
      ink: 13,
      inkMuted: 33,
      inkFaint: 42,
    },
    dark: {
      ground: 7,
      groundSunk: 4,
      paper: 13,
      paperShade: 11.5,
      ink: 92,
      inkMuted: 77,
      inkFaint: 63,
    },
  },
  medium: {
    light: {
      ground: 94,
      groundSunk: 91,
      paper: 99,
      paperShade: 97,
      ink: 9,
      inkMuted: 26,
      inkFaint: 33,
    },
    dark: {
      ground: 6,
      groundSunk: 3,
      paper: 12,
      paperShade: 10.5,
      ink: 95,
      inkMuted: 83,
      inkFaint: 72,
    },
  },
  high: {
    light: {
      ground: 95,
      groundSunk: 92,
      paper: 99.5,
      paperShade: 98,
      ink: 4,
      inkMuted: 16,
      inkFaint: 22,
    },
    dark: {
      ground: 4,
      groundSunk: 2,
      paper: 10,
      paperShade: 9,
      ink: 98,
      inkMuted: 91,
      inkFaint: 84,
    },
  },
};

/** Hairlines are ink at these alphas: `line` divides, `line-strong` outlines controls. */
export const LINE_ALPHAS: Record<ContrastName, Record<Mode, { line: number; strong: number }>> = {
  standard: { light: { line: 0.12, strong: 0.26 }, dark: { line: 0.1, strong: 0.2 } },
  medium: { light: { line: 0.18, strong: 0.38 }, dark: { line: 0.16, strong: 0.32 } },
  high: { light: { line: 0.3, strong: 0.6 }, dark: { line: 0.28, strong: 0.55 } },
};

/**
 * Accent tones besides the fill. `soft` is the tinted container (a selected chip, the current
 * nav item) and `ink` the accent as text on paper: links, the focus ring.
 */
export const ACCENT_TONES: Record<
  ContrastName,
  Record<Mode, { soft: number; onSoft: number; ink: number; fillShift: number }>
> = {
  standard: {
    light: { soft: 90, onSoft: 22, ink: 40, fillShift: 0 },
    dark: { soft: 24, onSoft: 88, ink: 80, fillShift: 0 },
  },
  medium: {
    light: { soft: 91, onSoft: 15, ink: 32, fillShift: 3 },
    dark: { soft: 22, onSoft: 92, ink: 86, fillShift: 3 },
  },
  high: {
    light: { soft: 93, onSoft: 6, ink: 22, fillShift: 7 },
    dark: { soft: 18, onSoft: 97, ink: 93, fillShift: 6 },
  },
};

/** A soft container keeps at most this much chroma, so a tinted chip stays calm. */
export const ACCENT_SOFT_CHROMA: Record<Mode, number> = { light: 20, dark: 14 };

/** In dark mode a fill keeps at most this much chroma, so bright accents don't glare. */
export const DARK_FILL_CHROMA = 46;

/** Danger: a warm red, harmonized like the tags. */
export const DANGER = { hue: 32, chroma: { light: 64, dark: 40 } } as const;
export const DANGER_TONES: Record<
  ContrastName,
  Record<Mode, { fill: number; onFill: number; soft: number; onSoft: number }>
> = {
  standard: {
    light: { fill: 40, onFill: 100, soft: 91, onSoft: 20 },
    dark: { fill: 78, onFill: 12, soft: 24, onSoft: 88 },
  },
  medium: {
    light: { fill: 34, onFill: 100, soft: 92, onSoft: 14 },
    dark: { fill: 84, onFill: 8, soft: 22, onSoft: 92 },
  },
  high: {
    light: { fill: 26, onFill: 100, soft: 94, onSoft: 6 },
    dark: { fill: 90, onFill: 4, soft: 18, onSoft: 97 },
  },
};

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
