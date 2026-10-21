/**
 * The type scale: Fraunces (`brand`) for titles and reading, Geist (`plain`) for the interface.
 * Role names follow the familiar display/headline/title/body/label ladder plus the two Clippings
 * roles (`reading`, `clipping-title`). Sizes, line heights and tracking are in px and become rem
 * in the generated CSS. Utilities are `typescale-<role>`, deliberately not `text-*`, so `cn`
 * never mistakes them for text colors.
 */
export interface TypescaleRole {
  /** `brand` is the serif, `plain` the UI sans. */
  family: "brand" | "plain";
  size: number;
  lineHeight: number;
  tracking: number;
  weight: number;
  /** Replaces the base metrics from the medium window class (600px) up. */
  medium?: { size: number; lineHeight: number };
  /** Replaces the base metrics when `data-density="compact"`. */
  compact?: { size: number; lineHeight: number; weight?: number };
}

export const TYPESCALE = {
  "display-lg": { family: "brand", size: 56, lineHeight: 62, tracking: -1, weight: 500 },
  "display-md": { family: "brand", size: 44, lineHeight: 50, tracking: -0.8, weight: 500 },
  "display-sm": { family: "brand", size: 36, lineHeight: 42, tracking: -0.5, weight: 500 },
  "headline-lg": { family: "brand", size: 34, lineHeight: 40, tracking: -0.5, weight: 500 },
  "headline-md": { family: "brand", size: 28, lineHeight: 34, tracking: -0.4, weight: 500 },
  "headline-sm": { family: "brand", size: 24, lineHeight: 30, tracking: -0.3, weight: 500 },
  "title-lg": { family: "brand", size: 20, lineHeight: 26, tracking: -0.1, weight: 500 },
  "title-md": { family: "plain", size: 16, lineHeight: 24, tracking: 0, weight: 600 },
  "title-md-emphasized": { family: "plain", size: 16, lineHeight: 24, tracking: 0, weight: 700 },
  "title-sm": { family: "plain", size: 14, lineHeight: 20, tracking: 0, weight: 600 },
  "body-lg": { family: "plain", size: 16, lineHeight: 24, tracking: 0, weight: 400 },
  "body-md": { family: "plain", size: 14, lineHeight: 21, tracking: 0, weight: 400 },
  "body-sm": { family: "plain", size: 12, lineHeight: 16, tracking: 0, weight: 400 },
  "label-lg": { family: "plain", size: 14, lineHeight: 20, tracking: 0, weight: 500 },
  "label-md": { family: "plain", size: 12, lineHeight: 16, tracking: 0.1, weight: 500 },
  "label-sm": { family: "plain", size: 11, lineHeight: 14, tracking: 0.3, weight: 500 },
  reading: {
    family: "brand",
    size: 17,
    lineHeight: 27,
    tracking: 0,
    weight: 400,
    medium: { size: 18, lineHeight: 29 },
  },
  "clipping-title": {
    family: "brand",
    size: 18,
    lineHeight: 24,
    tracking: -0.1,
    weight: 500,
    compact: { size: 16, lineHeight: 22 },
  },
} as const satisfies Record<string, TypescaleRole>;

export type TypescaleName = keyof typeof TYPESCALE;
export const TYPESCALE_NAMES = Object.keys(TYPESCALE) as TypescaleName[];
export const TYPESCALE_ROLES: Record<TypescaleName, TypescaleRole> = TYPESCALE;
