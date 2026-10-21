import {
  Hct,
  TonalPalette,
  argbFromHex,
  differenceDegrees,
  hexFromArgb,
  rotationDirection,
  sanitizeDegreesDouble,
} from "@material/material-color-utilities";

import { DEFAULT_PALETTE, PALETTE_NAMES, type PaletteName } from "@clippings/shared";

import {
  ACCENT_SOFT_CHROMA,
  ACCENT_TONES,
  CONTRAST_NAMES,
  DANGER,
  DARK_FILL_CHROMA,
  DANGER_TONES,
  LINE_ALPHAS,
  MODES,
  NEUTRAL_TONES,
  PALETTES,
  PAPER_CHROMA_SHARE,
  TAG_CHROMA,
  TAG_HUES,
  TAG_NAMES,
  TAG_TONES,
  type ContrastName,
  type Mode,
  type TagName,
} from "./palettes.ts";

/**
 * The color roles, in the order the CSS lists them. Ground is the page, paper the cards on it,
 * glass the frosted layers that float above both. Roles with an alpha are 8-digit hex.
 */
export const ROLE_NAMES = [
  "ground",
  "ground-sunk",
  "paper",
  "paper-shade",
  "ink",
  "ink-muted",
  "ink-faint",
  "line",
  "line-strong",
  "edge",
  "accent",
  "accent-top",
  "on-accent",
  "accent-soft",
  "on-accent-soft",
  "accent-ink",
  "danger",
  "on-danger",
  "danger-soft",
  "on-danger-soft",
  "glass",
  "glass-strong",
  "glass-edge",
  "scrim",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

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

/** A color by HCT. Tones may be fractional, which `TonalPalette` would round. */
const hct = (hue: number, chroma: number, tone: number): string =>
  hexFromArgb(Hct.from(hue, chroma, Math.min(100, Math.max(0, tone))).toInt());

const withAlpha = (hex: string, alpha: number): string =>
  `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;

// WCAG 2.x relative luminance and contrast, to pick the readable text for a fill.
const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Near-black text on a light fill, white on a dark one. */
const DARK_TEXT_TONE = 10;

const buildScheme = (
  palette: PaletteName,
  tagHues: Record<TagName, number>,
  contrast: ContrastName,
  mode: Mode,
): SchemeColors => {
  const { seed, fill, neutral } = PALETTES[palette];
  const accent = Hct.fromInt(argbFromHex(seed));
  const n = NEUTRAL_TONES[contrast][mode];
  const lines = LINE_ALPHAS[contrast][mode];
  const a = ACCENT_TONES[contrast][mode];
  const d = DANGER_TONES[contrast][mode];
  const isDark = mode === "dark";

  const neutralColor = (tone: number) => hct(neutral.hue, neutral.chroma, tone);
  const paperColor = (tone: number) => hct(neutral.hue, neutral.chroma * PAPER_CHROMA_SHARE, tone);
  const fillChroma = isDark ? Math.min(accent.chroma, DARK_FILL_CHROMA) : accent.chroma;
  const accentColor = (tone: number, chroma = fillChroma) => hct(accent.hue, chroma, tone);

  // The fill carries whichever text reads better on it at standard contrast; higher levels move
  // the fill away from that text rather than flipping it.
  const baseFill = accentColor(fill[mode]);
  const darkText = accentColor(DARK_TEXT_TONE, 8);
  const textIsDark = contrastRatio(darkText, baseFill) >= contrastRatio("#ffffff", baseFill);
  const fillTone = fill[mode] + (textIsDark ? a.fillShift : -a.fillShift);
  const softChroma = Math.min(accent.chroma, ACCENT_SOFT_CHROMA[mode]);
  const onAccent = textIsDark ? darkText : "#ffffff";

  // The fill's gradient starts a little lighter at the top, but never so light that its label
  // drops below the fill's own minimum: 4.5:1, 6:1 at high contrast.
  const accentTop = () => {
    const minimum = contrast === "high" ? 6 : 4.5;
    for (let lift = isDark ? 6 : 7; lift > 0; lift -= 0.5) {
      const top = accentColor(Math.min(96, fillTone + lift));
      if (contrastRatio(onAccent, top) >= minimum) return top;
    }
    return accentColor(fillTone);
  };
  const ink = neutralColor(n.ink);
  const paper = paperColor(n.paper);
  const ground = neutralColor(n.ground);

  // A control's boundary (a text field's edge, the selected segment): the faintest neutral that
  // still stands 3:1 against paper and ground (WCAG 1.4.11), 4.5:1 at high contrast.
  const edgeColor = () => {
    const minimum = contrast === "high" ? 4.5 : 3;
    for (let step = 0; step <= 100; step += 0.5) {
      const edge = neutralColor(isDark ? n.paper + step : n.paper - step);
      if (contrastRatio(edge, paper) >= minimum && contrastRatio(edge, ground) >= minimum) {
        return edge;
      }
    }
    return ink;
  };

  const roles: Record<RoleName, string> = {
    ground,
    "ground-sunk": neutralColor(n.groundSunk),
    paper,
    "paper-shade": paperColor(n.paperShade),
    ink,
    "ink-muted": neutralColor(n.inkMuted),
    "ink-faint": neutralColor(n.inkFaint),
    line: withAlpha(ink, lines.line),
    "line-strong": withAlpha(ink, lines.strong),
    edge: edgeColor(),
    accent: accentColor(fillTone),
    "accent-top": accentTop(),
    "on-accent": onAccent,
    "accent-soft": accentColor(a.soft, softChroma),
    "on-accent-soft": accentColor(a.onSoft, softChroma),
    "accent-ink": accentColor(a.ink),
    danger: hct(DANGER.hue, DANGER.chroma[mode], d.fill),
    "on-danger": hct(DANGER.hue, d.onFill === 100 ? 0 : 8, d.onFill),
    "danger-soft": hct(DANGER.hue, 24, d.soft),
    "on-danger-soft": hct(DANGER.hue, 24, d.onSoft),
    glass: withAlpha(paper, isDark ? 0.6 : 0.62),
    "glass-strong": withAlpha(paper, isDark ? 0.82 : 0.84),
    "glass-edge": isDark ? withAlpha(ink, 0.1) : withAlpha("#ffffff", 0.72),
    scrim: isDark ? withAlpha("#000000", 0.45) : withAlpha(neutralColor(10), 0.18),
  };

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
    lines.push(`  --pg-${role}: ${lightDark(scheme.light.roles[role], scheme.dark.roles[role])};`);
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
 * The theme CSS is scoped to the active `data-palette`, so a settings page can't read another
 * palette's colors from it. This `:root` block holds each palette's accent fill and soft container
 * (standard contrast), always available as `--palette-<name>-accent[-soft]`.
 */
const swatchesRule = (theme: Theme): string => {
  const lines = PALETTE_NAMES.flatMap((palette) => {
    const { light, dark } = theme.palettes[palette].schemes.standard;
    return [
      `  --palette-${palette}-accent: ${lightDark(light.roles.accent, dark.roles.accent)};`,
      `  --palette-${palette}-accent-top: ${lightDark(light.roles["accent-top"], dark.roles["accent-top"])};`,
      `  --palette-${palette}-on-accent: ${lightDark(light.roles["on-accent"], dark.roles["on-accent"])};`,
      `  --palette-${palette}-soft: ${lightDark(light.roles["accent-soft"], dark.roles["accent-soft"])};`,
    ];
  });
  return [":root {", ...lines, "}"].join("\n");
};

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

  blocks.push(swatchesRule(theme));
  blocks.push(`@media (prefers-contrast: more) {\n${raised.join("\n\n")}\n}`);
  return `${blocks.join("\n\n")}\n`;
};

/** `tokens.json`: hex values for consumers that can't read CSS (meta tags, manifest, badges). */
export const renderTokensJson = (theme: Theme): string => `${JSON.stringify(theme, null, 2)}\n`;
