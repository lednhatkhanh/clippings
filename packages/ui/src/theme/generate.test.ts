import { Hct, argbFromHex } from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";

import { generateTheme, renderThemesCss, renderTokensJson } from "./generate.ts";

// The system roles Material Theme Builder exports (49), spelled out here as the
// spec rather than read back from the generator.
const REQUIRED_ROLES = [
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
  "background",
  "on-background",
  "surface",
  "on-surface",
  "surface-variant",
  "on-surface-variant",
  "outline",
  "outline-variant",
  "shadow",
  "scrim",
  "inverse-surface",
  "inverse-on-surface",
  "inverse-primary",
  "primary-fixed",
  "on-primary-fixed",
  "primary-fixed-dim",
  "on-primary-fixed-variant",
  "secondary-fixed",
  "on-secondary-fixed",
  "secondary-fixed-dim",
  "on-secondary-fixed-variant",
  "tertiary-fixed",
  "on-tertiary-fixed",
  "tertiary-fixed-dim",
  "on-tertiary-fixed-variant",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "surface-tint",
] as const;

// WCAG 2.x relative luminance and contrast ratio, written out from the definition.
const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrastRatio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// Design hues of the eight tag colors, before harmonizing to a palette seed.
const TAG_BASE_HUES = {
  red: 27,
  orange: 60,
  amber: 91,
  green: 146,
  teal: 193,
  blue: 255,
  violet: 305,
  pink: 355,
} as const;
const TAGS = Object.keys(TAG_BASE_HUES) as (keyof typeof TAG_BASE_HUES)[];

const hueDistance = (a: number, b: number) => {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
};

interface Rule {
  atRule: string | null;
  selector: string;
  declarations: Map<string, string>;
}

// Just enough CSS parsing for generated output: rules, one level of @media, declarations.
const parseRules = (source: string, atRule: string | null = null): Rule[] => {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    while (depth > 0) {
      if (css[close] === "{") depth += 1;
      if (css[close] === "}") depth -= 1;
      close += 1;
    }
    const prelude = css.slice(index, open).trim();
    const body = css.slice(open + 1, close - 1);
    if (prelude.startsWith("@media")) {
      rules.push(...parseRules(body, prelude));
    } else {
      const declarations = new Map<string, string>();
      for (const declaration of body.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon > -1) {
          declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
        }
      }
      for (const selector of prelude.split(",")) {
        rules.push({ atRule, selector: selector.trim(), declarations });
      }
    }
    index = close;
  }
  return rules;
};

const lightDark = (light: string, dark: string) => `light-dark(${light}, ${dark})`;

const findRule = (rules: Rule[], selector: string, atRule: string | null = null) => {
  const rule = rules.find((r) => r.selector === selector && r.atRule === atRule);
  expect(rule, `rule ${atRule ?? ""} ${selector}`).toBeDefined();
  return rule!.declarations;
};

const PALETTES = ["olive", "ochre", "terracotta", "ink"] as const;
const CONTRASTS = ["standard", "medium", "high"] as const;
const MODES = ["light", "dark"] as const;

describe("generateTheme", () => {
  it("emits every system role for every palette, contrast level and mode", () => {
    const theme = generateTheme();

    expect(Object.keys(theme.palettes).toSorted()).toEqual([...PALETTES].toSorted());
    for (const palette of PALETTES) {
      for (const contrast of CONTRASTS) {
        for (const mode of MODES) {
          const { roles } = theme.palettes[palette].schemes[contrast][mode];
          expect(Object.keys(roles).toSorted(), `${palette} ${contrast} ${mode}`).toEqual(
            [...REQUIRED_ROLES].toSorted(),
          );
          for (const hex of Object.values(roles)) {
            expect(hex).toMatch(/^#[0-9a-f]{6}$/);
          }
        }
      }
    }
  });

  it("keeps text, accent and outline pairs readable at every contrast level", () => {
    const theme = generateTheme();
    const minimums = [
      ["on-surface", "surface", 7],
      ["primary", "surface", 4.5],
      ["outline", "surface", 3],
    ] as const;

    for (const palette of PALETTES) {
      for (const contrast of CONTRASTS) {
        for (const mode of MODES) {
          const { roles } = theme.palettes[palette].schemes[contrast][mode];
          for (const [foreground, background, minimum] of minimums) {
            const ratio = contrastRatio(roles[foreground], roles[background]);
            expect(
              ratio,
              `${palette} ${contrast} ${mode}: ${foreground} on ${background}`,
            ).toBeGreaterThanOrEqual(minimum);
          }
        }
      }
    }
  });

  it("never lets a light surface be pure white", () => {
    const theme = generateTheme();

    for (const palette of PALETTES) {
      for (const contrast of CONTRASTS) {
        const { roles } = theme.palettes[palette].schemes[contrast].light;
        const surfaces = Object.entries(roles).filter(
          ([name]) => name.startsWith("surface") || name === "background",
        );
        expect(surfaces.length).toBeGreaterThan(0);
        for (const [name, hex] of surfaces) {
          expect(hex, `${palette} ${contrast}: ${name}`).not.toBe("#ffffff");
        }
      }
    }
  });

  it("rotates each tag hue toward the palette seed by at most 15 degrees", () => {
    const theme = generateTheme();

    for (const palette of PALETTES) {
      const { seed, tagHues } = theme.palettes[palette];
      const seedHue = Hct.fromInt(argbFromHex(seed)).hue;
      for (const tag of TAGS) {
        const base = TAG_BASE_HUES[tag];
        const moved = tagHues[tag];
        expect(hueDistance(base, moved), `${palette} ${tag}`).toBeLessThanOrEqual(15 + 1e-6);
        expect(hueDistance(moved, seedHue), `${palette} ${tag} toward seed`).toBeLessThanOrEqual(
          hueDistance(base, seedHue) + 1e-6,
        );
      }
    }
  });

  it("keeps tag text at least 7:1 against its container in every palette, mode and level", () => {
    const theme = generateTheme();

    for (const palette of PALETTES) {
      for (const contrast of CONTRASTS) {
        for (const mode of MODES) {
          const { tags } = theme.palettes[palette].schemes[contrast][mode];
          expect(Object.keys(tags).toSorted()).toEqual([...TAGS].toSorted());
          for (const tag of TAGS) {
            const { container, onContainer, dot } = tags[tag];
            expect(dot).toMatch(/^#[0-9a-f]{6}$/);
            expect(
              contrastRatio(onContainer, container),
              `${palette} ${contrast} ${mode}: ${tag}`,
            ).toBeGreaterThanOrEqual(7);
          }
        }
      }
    }
  });

  it("writes tokens.json with the same colors as the generated CSS", () => {
    const theme = generateTheme();
    const rules = parseRules(renderThemesCss(theme));
    const tokens = JSON.parse(renderTokensJson(theme));

    for (const palette of PALETTES) {
      for (const contrast of CONTRASTS) {
        const declarations = findRule(
          rules,
          `:root[data-palette="${palette}"][data-contrast="${contrast}"]`,
        );
        for (const role of REQUIRED_ROLES) {
          const [, light, dark] =
            /^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/.exec(
              declarations.get(`--md-sys-color-${role}`) ?? "",
            ) ?? [];
          const scheme = tokens.palettes[palette].schemes[contrast];
          expect(scheme.light.roles[role], `${palette} ${contrast} light ${role}`).toBe(light);
          expect(scheme.dark.roles[role], `${palette} ${contrast} dark ${role}`).toBe(dark);
        }
        for (const tag of TAGS) {
          for (const part of ["container", "on-container", "dot"] as const) {
            const key = part === "on-container" ? "onContainer" : part;
            const declared = declarations.get(`--tag-${tag}-${part}`);
            const { light, dark } = tokens.palettes[palette].schemes[contrast];
            expect(declared, `${palette} ${contrast} ${tag} ${part}`).toBe(
              lightDark(light.tags[tag][key], dark.tags[tag][key]),
            );
          }
        }
      }
    }
  });
});
