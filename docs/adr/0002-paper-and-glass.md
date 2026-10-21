# Design system: Paper & Glass instead of Material 3

The first design system followed Material 3: Tonal Spot schemes from `material-color-utilities`,
the M3 role names (`surface-container-high`, `on-secondary-container`), state-layer ripples, the
Material Symbols font and M3's motion springs. It worked, but it read as Android, and the role names
said where a color came from rather than what it is for.

Paper & Glass keeps what mattered (four palettes, light and dark, three contrast levels generated
and tested for contrast, warm paper) and drops the Material idiom:

- **Roles by purpose.** `ground` (the page), `paper` (cards and sheets), `ink`/`ink-muted`/
  `ink-faint` (text), `line`, one `accent` with `accent-soft` and `accent-ink`, `danger`, and
  `glass`. They are still generated per palette and contrast level from HCT tones
  (`packages/ui/src/theme/palettes.ts`), with `material-color-utilities` used only as an HCT
  library; `generate.test.ts` holds every text pair to 4.5:1, or 7:1 at high contrast.
- **Paper for content, glass for what floats.** Cards are paper with soft warm shadows; the rail,
  header and tab bar are frosted glass; menus, dialogs and toasts are a denser glass. Without
  backdrop blur, or with reduced transparency, glass falls back to solid paper.
- **Lucide icons** (`lucide-react`) at a 1.75 stroke replace the Material Symbols subset font, so
  icons tree-shake per page and need no font build.
- **Fraunces and Geist** replace Literata and Roboto Flex.
- **Calm motion.** Entrances settle on a paper spring with 0.6% overshoot, exits are quicker, and
  only the saved check and a new tag pop. Reduced motion keeps fades and stops travel.

The design itself, with every state and the motion, is the "Clippings — Paper & Glass" canvas.

## Considered options

- **Keep the M3 role names and only change their values.** Fewer files touched, but every class
  would keep naming a Material role the design no longer has.
- **Hand-picked hex values per palette.** Simpler to read, but each new contrast level or palette
  would need its own hand tuning; tones keep the levels and palettes consistent and testable.

## Consequences

Palette ids stay `olive`, `ochre`, `terracotta`, `ink` because they are stored in
`user_settings.palette`. Installed icons and the favicon use a fixed ochre brand tile rather than
the default palette, since the OS caches them.
