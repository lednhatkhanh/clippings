import {
  Hct,
  type DynamicColor,
  DynamicScheme,
  SchemeTonalSpot,
  TonalPalette,
  Variant,
  argbFromHex,
  differenceDegrees,
  hexFromArgb,
  rotationDirection,
  sanitizeDegreesDouble,
} from "@material/material-color-utilities";

import {
  CONTRAST_LEVELS,
  CONTRAST_NAMES,
  DEFAULT_PALETTE,
  MODES,
  PALETTE_NAMES,
  PALETTES,
  TAG_CHROMA,
  TAG_HUES,
  TAG_NAMES,
  TAG_TONES,
  type ContrastName,
  type Mode,
  type PaletteName,
  type TagName,
} from "./palettes.ts";

const WHITE = 0xffffffff;

type ColorGetter = (scheme: DynamicScheme) => DynamicColor;

const ROLE_TABLE = {
  primary: (s) => s.colors.primary(),
  "on-primary": (s) => s.colors.onPrimary(),
  "primary-container": (s) => s.colors.primaryContainer(),
  "on-primary-container": (s) => s.colors.onPrimaryContainer(),
  secondary: (s) => s.colors.secondary(),
  "on-secondary": (s) => s.colors.onSecondary(),
  "secondary-container": (s) => s.colors.secondaryContainer(),
  "on-secondary-container": (s) => s.colors.onSecondaryContainer(),
  tertiary: (s) => s.colors.tertiary(),
  "on-tertiary": (s) => s.colors.onTertiary(),
  "tertiary-container": (s) => s.colors.tertiaryContainer(),
  "on-tertiary-container": (s) => s.colors.onTertiaryContainer(),
  error: (s) => s.colors.error(),
  "on-error": (s) => s.colors.onError(),
  "error-container": (s) => s.colors.errorContainer(),
  "on-error-container": (s) => s.colors.onErrorContainer(),
  background: (s) => s.colors.background(),
  "on-background": (s) => s.colors.onBackground(),
  surface: (s) => s.colors.surface(),
  "on-surface": (s) => s.colors.onSurface(),
  "surface-variant": (s) => s.colors.surfaceVariant(),
  "on-surface-variant": (s) => s.colors.onSurfaceVariant(),
  outline: (s) => s.colors.outline(),
  "outline-variant": (s) => s.colors.outlineVariant(),
  shadow: (s) => s.colors.shadow(),
  scrim: (s) => s.colors.scrim(),
  "inverse-surface": (s) => s.colors.inverseSurface(),
  "inverse-on-surface": (s) => s.colors.inverseOnSurface(),
  "inverse-primary": (s) => s.colors.inversePrimary(),
  "primary-fixed": (s) => s.colors.primaryFixed(),
  "on-primary-fixed": (s) => s.colors.onPrimaryFixed(),
  "primary-fixed-dim": (s) => s.colors.primaryFixedDim(),
  "on-primary-fixed-variant": (s) => s.colors.onPrimaryFixedVariant(),
  "secondary-fixed": (s) => s.colors.secondaryFixed(),
  "on-secondary-fixed": (s) => s.colors.onSecondaryFixed(),
  "secondary-fixed-dim": (s) => s.colors.secondaryFixedDim(),
  "on-secondary-fixed-variant": (s) => s.colors.onSecondaryFixedVariant(),
  "tertiary-fixed": (s) => s.colors.tertiaryFixed(),
  "on-tertiary-fixed": (s) => s.colors.onTertiaryFixed(),
  "tertiary-fixed-dim": (s) => s.colors.tertiaryFixedDim(),
  "on-tertiary-fixed-variant": (s) => s.colors.onTertiaryFixedVariant(),
  "surface-dim": (s) => s.colors.surfaceDim(),
  "surface-bright": (s) => s.colors.surfaceBright(),
  "surface-container-lowest": (s) => s.colors.surfaceContainerLowest(),
  "surface-container-low": (s) => s.colors.surfaceContainerLow(),
  "surface-container": (s) => s.colors.surfaceContainer(),
  "surface-container-high": (s) => s.colors.surfaceContainerHigh(),
  "surface-container-highest": (s) => s.colors.surfaceContainerHighest(),
  "surface-tint": (s) => s.colors.surfaceTint(),
} satisfies Record<string, ColorGetter>;

export type RoleName = keyof typeof ROLE_TABLE;
export const ROLE_NAMES = Object.keys(ROLE_TABLE) as RoleName[];

export interface TagColors {
  container: string;
  onContainer: string;
  dot: string;
}

export interface SchemeColors {
  roles: Record<RoleName, string>;
  tags: Record<TagName, TagColors>;
}

export interface PaletteTheme {
  seed: string;
  /** Tag hues after harmonizing toward the seed. */
  tagHues: Record<TagName, number>;
  schemes: Record<ContrastName, Record<Mode, SchemeColors>>;
}

export interface Theme {
  palettes: Record<PaletteName, PaletteTheme>;
}

const MAX_HARMONIZE_DEGREES = 15;

/**
 * Same rule as `Blend.harmonize`: rotate toward the source hue by half the angular difference,
 * capped at 15 degrees. Done on the hue directly because harmonizing a chroma-36 color first
 * would gamut-clip it and shift the hue.
 */
const harmonizeHue = (hue: number, sourceHue: number): number => {
  const rotation = Math.min(differenceDegrees(hue, sourceHue) * 0.5, MAX_HARMONIZE_DEGREES);
  return sanitizeDegreesDouble(hue + rotation * rotationDirection(hue, sourceHue));
};

const buildTagHues = (palette: PaletteName): Record<TagName, number> => {
  const sourceHue = Hct.fromInt(argbFromHex(PALETTES[palette].seed)).hue;
  return Object.fromEntries(
    TAG_NAMES.map((tag) => [tag, harmonizeHue(TAG_HUES[tag], sourceHue)]),
  ) as Record<TagName, number>;
};

const buildTags = (
  tagHues: Record<TagName, number>,
  contrast: ContrastName,
  mode: Mode,
): Record<TagName, TagColors> => {
  const tones = TAG_TONES[contrast][mode];
  return Object.fromEntries(
    TAG_NAMES.map((tag) => {
      const tonal = TonalPalette.fromHueAndChroma(tagHues[tag], TAG_CHROMA);
      return [
        tag,
        {
          container: hexFromArgb(tonal.tone(tones.container)),
          onContainer: hexFromArgb(tonal.tone(tones.onContainer)),
          dot: hexFromArgb(tonal.tone(tones.dot)),
        },
      ];
    }),
  ) as Record<TagName, TagColors>;
};

const buildScheme = (
  palette: PaletteName,
  tagHues: Record<TagName, number>,
  contrast: ContrastName,
  mode: Mode,
): SchemeColors => {
  const { seed, neutral } = PALETTES[palette];
  const source = Hct.fromInt(argbFromHex(seed));
  const isDark = mode === "dark";
  const contrastLevel = CONTRAST_LEVELS[contrast];
  const base = new SchemeTonalSpot(source, isDark, contrastLevel, "2021");
  const scheme = new DynamicScheme({
    sourceColorHct: source,
    variant: Variant.TONAL_SPOT,
    contrastLevel,
    isDark,
    specVersion: "2021",
    primaryPalette: base.primaryPalette,
    secondaryPalette: base.secondaryPalette,
    tertiaryPalette: base.tertiaryPalette,
    neutralPalette: TonalPalette.fromHueAndChroma(neutral.hue, neutral.chroma),
    neutralVariantPalette: TonalPalette.fromHueAndChroma(neutral.hue, neutral.chroma + 4),
  });

  // `surface-container-lowest` is tone 100 in light mode, which is #ffffff for every neutral
  // palette. Paper is never white, so surfaces step down to tone 99 of the warm neutral.
  const paperWhite = scheme.neutralPalette.tone(99);
  const isSurface = (name: RoleName) => name.startsWith("surface") || name === "background";

  const roles = Object.fromEntries(
    ROLE_NAMES.map((name) => {
      const argb = scheme.getArgb(ROLE_TABLE[name](scheme));
      const clamped = !isDark && isSurface(name) && argb === WHITE ? paperWhite : argb;
      return [name, hexFromArgb(clamped)];
    }),
  ) as Record<RoleName, string>;

  return { roles, tags: buildTags(tagHues, contrast, mode) };
};

export const generateTheme = (): Theme => {
  const palettes = Object.fromEntries(
    PALETTE_NAMES.map((palette) => {
      const tagHues = buildTagHues(palette);
      const schemes = Object.fromEntries(
        CONTRAST_NAMES.map((contrast) => [
          contrast,
          Object.fromEntries(
            MODES.map((mode) => [mode, buildScheme(palette, tagHues, contrast, mode)]),
          ),
        ]),
      );
      return [palette, { seed: PALETTES[palette].seed, tagHues, schemes }];
    }),
  ) as Record<PaletteName, PaletteTheme>;

  return { palettes };
};

const GENERATED_HEADER = "/* Generated by packages/ui/scripts/generate-theme.ts. Do not edit. */";

const lightDark = (light: string, dark: string) => `light-dark(${light}, ${dark})`;

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const declarations = (scheme: Record<Mode, SchemeColors>): string[] => {
  const lines: string[] = [];
  for (const role of ROLE_NAMES) {
    lines.push(
      `  --md-sys-color-${role}: ${lightDark(scheme.light.roles[role], scheme.dark.roles[role])};`,
    );
  }
  for (const tag of TAG_NAMES) {
    for (const part of ["container", "onContainer", "dot"] as const) {
      const value = lightDark(scheme.light.tags[tag][part], scheme.dark.tags[tag][part]);
      lines.push(`  --tag-${tag}-${kebab(part)}: ${value};`);
    }
  }
  return lines;
};

const rule = (selectors: string[], scheme: Record<Mode, SchemeColors>, indent = ""): string =>
  [
    `${indent}${selectors.join(`,\n${indent}`)} {`,
    ...declarations(scheme).map((line) => `${indent}${line}`),
    `${indent}}`,
  ].join("\n");

/**
 * `themes.css`: every role and tag color as `light-dark(L, D)`, per palette and contrast level.
 * Mode comes from `color-scheme`. Without `data-contrast` the standard level applies, and
 * `prefers-contrast: more` raises that default to medium. An explicit `data-contrast` always wins.
 */
export const renderThemesCss = (theme: Theme): string => {
  const blocks: string[] = [GENERATED_HEADER];
  const raised: string[] = [];

  for (const palette of PALETTE_NAMES) {
    const { schemes } = theme.palettes[palette];
    const scopes = [`:root[data-palette="${palette}"]`];
    if (palette === DEFAULT_PALETTE) scopes.push(":root:not([data-palette])");

    blocks.push(
      rule(
        [...scopes, ...scopes.map((scope) => `${scope}[data-contrast="standard"]`)],
        schemes.standard,
      ),
    );
    blocks.push(
      rule(
        scopes.map((scope) => `${scope}[data-contrast="medium"]`),
        schemes.medium,
      ),
    );
    blocks.push(
      rule(
        scopes.map((scope) => `${scope}[data-contrast="high"]`),
        schemes.high,
      ),
    );
    raised.push(
      rule(
        scopes.map((scope) => `${scope}:not([data-contrast])`),
        schemes.medium,
        "  ",
      ),
    );
  }

  blocks.push(`@media (prefers-contrast: more) {\n${raised.join("\n\n")}\n}`);
  return `${blocks.join("\n\n")}\n`;
};

/** `tokens.json`: hex values for consumers that can't read CSS (meta tags, manifest, badges). */
export const renderTokensJson = (theme: Theme): string => `${JSON.stringify(theme, null, 2)}\n`;
