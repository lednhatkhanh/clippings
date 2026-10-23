# Service worker: hand-written instead of Serwist or Workbox

The PWA's service worker is about a hundred lines of plain JavaScript, served by
`app/sw.js/route.ts` from `apps/web/lib/pwa/service-worker.ts`, with no build step. It caches only
content-hashed `/_next/static/` assets, the icons and the manifest, cache-first in one cache per
deployment; it precaches the offline page; navigations go to the network (with navigation preload)
and fall back to the offline page. Pages, RSC payloads, the API, auth and MCP are never stored,
since every row belongs to one user.

## Considered options

- **Serwist** (checked at 9.5.13, October 2026). `@serwist/next` needs webpack, and this app builds
  with Turbopack. `@serwist/turbopack` says it is for apps without `cacheComponents`, which this app
  has on, and has an open crash on Vercel for Next 16.x (serwist/serwist#360). Its configurator mode
  works under Turbopack but adds a post-build CLI step, a generated `public/sw.js` and a dev
  watcher. Its default runtime caching stores HTML, RSC payloads and same-origin `/api/` GETs, which
  would have to be overridden to keep user data out of the cache.
- **Workbox** (7.4.1). Serwist is its fork, so the trade-offs are the same, and it has no Next.js 16
  or Turbopack integration: `next-pwa` is webpack-only and unmaintained. Using it would mean
  bundling the worker and running `injectManifest` after `next build`, which `vercel build` doesn't
  leave room for.

What either would add is precaching every build chunk and ready-made strategies and expiration.
The app needs neither: the static cache fills as pages load and is dropped with each deployment, and
nothing per-user is cached.

## Consequences

- Revisit this if the app needs offline reading of saved clippings, background sync of saves, or
  precaching for a first offline launch. Any of those would also mean deciding what per-user data
  may live on the device.
- The worker stays readable in one file and is tested in a production build (`next start`), as in
  `docs/agents/verifying.md`.
