# Paper & Glass: the design canvas

A backup of the design the app's Paper & Glass redesign was built from
([ADR 0002](../../adr/0002-paper-and-glass.md)), copied from the "Clippings — Paper & Glass" canvas
on claude.ai. The code is the source of truth now; these files show the intent behind it.

| File | What it shows |
| --- | --- |
| `Main.dc.html`, `HomeDark.dc.html` | Home on desktop: glass rail and header, paper clipping cards (light, dark) |
| `Detail.dc.html`, `DetailDark.dc.html` | A clipping on a phone: glass header and tab bar, the paper sheet |
| `Settings.dc.html` | Settings, with a working Mode and Accent picker |
| `Overlays.dc.html` | Command palette, actions menu and toast as float glass |
| `System.dc.html` | Tokens and every React Aria state, light and dark side by side |
| `Keyboard.dc.html` | The shortcuts sheet, the focus ring and the tab order |
| `Favicon.dc.html` | The mark at every size (the real icons: `apps/web/lib/pwa/app-icon.ts`) |
| `Motion.dc.html`, `Pages.dc.html` | Motion and page transitions, with Play buttons |
| `canvas.json` | The canvas layout: where each board sits, its size and title |

Each `.dc.html` is a Design Component page: plain HTML and CSS with `{{holes}}` and a small
`DCLogic` class, rendered by the canvas's runtime (`support.js`, not included). Opened directly in
a browser it shows the static markup without its tweaks or interactions. To see it as designed,
upload the folder to a Design canvas on claude.ai, or ask Claude to republish it.

The mockups' hex values were the design's starting point; the shipped colors are generated per
palette and contrast level in `packages/ui/src/theme/` and differ slightly. Palette "Sage" in the
mockups ships as `olive`, the stored palette id.
