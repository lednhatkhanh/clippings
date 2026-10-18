/**
 * Every Material Symbols icon the app uses, in alphabetical order. The subset font is built
 * from this list (`pnpm --filter @clippings/ui build:icons`) and `check:icons` fails when the
 * font and this list disagree, so a name outside it never ships as raw ligature text.
 */
export const ICON_NAMES = [
  "add",
  "arrow_back",
  "bookmarks",
  "chevron_right",
  "close",
  "delete",
  "language",
  "open_in_new",
  "sell",
  "settings",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
