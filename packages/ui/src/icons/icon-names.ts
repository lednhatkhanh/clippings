/**
 * Every Material Symbols icon the app uses, in alphabetical order. The subset font is built
 * from this list (`pnpm --filter @clippings/ui build:icons`) and `check:icons` fails when the
 * font and this list disagree, so a name outside it never ships as raw ligature text.
 */
export const ICON_NAMES = [
  "add",
  "arrow_back",
  "bookmarks",
  "check",
  "chevron_right",
  "close",
  "delete",
  "download",
  "install_desktop",
  "ios_share",
  "language",
  "logout",
  "open_in_new",
  "search",
  "sell",
  "settings",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
