/**
 * Every Material Symbols icon the app uses, in alphabetical order. The subset font is built
 * from this list (`pnpm --filter @clippings/ui build:icons`) and `check:icons` fails when the
 * font and this list disagree, so a name outside it never ships as raw ligature text.
 */
export const ICON_NAMES = ["bookmarks", "sell", "settings"] as const;

export type IconName = (typeof ICON_NAMES)[number];
