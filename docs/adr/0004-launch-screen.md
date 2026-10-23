# Launch screen: iOS startup images only, the ground color everywhere

The installed app on iOS sometimes showed a black screen for about two seconds before the UI.
That screen is the launch screen. iOS ignores the manifest's `background_color` and `icons` for it,
and draws an `apple-touch-startup-image` only when one matches the device's `device-width`,
`device-height`, pixel ratio and orientation exactly. The app had none, so iOS showed a blank
screen, black in dark mode, until the first paint. Navigations are network-only
(`docs/adr/0003-hand-written-service-worker.md`), so on a cold launch the first paint waits for the
proxy, the session check and a function that may be cold. That is what "some launches" means: a
warm launch resumes from iOS's snapshot, and a cold one waits on the network.

Each iPhone and iPad screen size now gets a startup image in light and dark: the rounded mark,
112pt wide, centred on the default palette's `ground`. `lib/pwa/launch-screen.ts` lists the
devices, `build:app-icons` renders the PNGs to `public/launch/`, and `manifest.test.ts` fails when
they are stale. The root layout links them and also declares `apple-mobile-web-app-capable`, since
Next.js writes only the standard `mobile-web-app-capable`.

From the launch screen to the UI, the screen stays the ground color. An inline style in `<head>`
paints `<html>` with the ground for the theme (`data-theme`, else the OS) before the stylesheets
arrive. After that the prerendered shell paints, and the session check and the page stream into it.
Nothing animates at the handoff, so reduced motion needs no special case.

## Desktop and the mobile web

They get no splash screen.

- **A browser tab**, on the phone or on desktop, keeps showing the previous page or the browser's
  own loading UI until the first paint, and the shell prerenders. A splash screen would only cover
  UI that is already there.
- **Android** builds its own splash screen from the manifest's `name`, `background_color` and
  icon, so it already shows the mark on the ground.
- **An installed desktop app** (Chrome or Edge) fills the new window with `background_color` until
  the first paint, usually in well under a second. Native desktop apps have no splash screens
  either.

The inline ground style covers all three. The manifest has one `background_color`, so on Android
and desktop the light ground shows briefly before a dark page. No browser ships a dark
`background_color` yet. Add one when the manifest gets it.

## Consequences

- iOS reads the startup images when the app is added to the Home Screen. An app installed before
  this change keeps its blank launch screen until it is removed and added again.
- A new device size gets the blank launch screen until it gets a row in `launch-screen.ts`.
- The two seconds themselves are the network. A service worker that served a cached shell to
  navigations would remove them, at the cost of the "pages are never stored" rule in ADR 0003.
