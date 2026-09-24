# PWA & Install

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** `apps/web` is an installable Progressive Web App. Its app shell
is precached by the service worker, so the installed app opens instantly
and keeps working through a dropped connection, and it can be added to
an Android home screen from a control inside the app rather than from a
buried browser menu. This matters beyond convenience: an installed app is
what keeps Web Push arriving once the browser is closed, and on
iOS/iPadOS an installed app is the **only** context where Web Push works
at all (`docs/features/push-notifications.md`).

**Technical Detail:**

- **One service worker, two jobs.** `apps/web/src/sw.js` handles Web Push
  (`push`, `notificationclick` — see `docs/features/announcement-push.md`)
  *and* offline caching. It lives in `src/`, not `public/`, and is
  compiled by `vite-plugin-pwa` in **`injectManifest`** mode. The plugin's
  only contribution is substituting `self.__WB_MANIFEST` with the
  content-hashed list of build artifacts; every handler is hand-written.
  `generateSW` mode would overwrite all of it and must never be used.
- **The worker stays import-free** even though it is now built. That is a
  deliberate constraint, not an oversight: `apps/web/src/lib/sw.test.ts`
  loads the SOURCE into a `node:vm` sandbox to exercise handlers directly
  without a build step, and an `import` statement would end that.
- **Registered at boot, not on push opt-in** (`src/main.tsx`). A browser
  only offers "Install app" for a page with a manifest AND a service
  worker with a fetch handler. Registering lazily meant no install prompt
  until someone enabled notifications — which, on Apple devices, they
  could not do until they installed. `docs/features/push-notifications.md`
  covers the push half of that same registration.
- **Precache is versioned by content.** The cache name is derived from a
  hash of the injected manifest, so a deploy lands in a *new* cache and
  `activate` deletes the old one. A fixed cache key is the classic way a
  precaching worker pins users to a build that no longer exists on the
  server.
- **What is cached, and what is deliberately not.** Cache-first applies
  **only** to same-origin paths present in the injected manifest — all
  content-hashed, so a cache hit can never be stale. `/api/*`, Supabase,
  and OSM tiles are never cached: serving a stale outbreak risk reading
  is worse for this application than serving an error. A failed
  navigation falls back to the precached `index.html` (the SPA shell can
  render the real route once booted) and only then to
  `public/offline.html`.
- **Precaching is per-entry, never `addAll`.** `addAll` is atomic, so one
  asset 404ing during a deploy rollover would discard the entire
  precache. Each entry is put independently and a failure degrades that
  one asset to a network fetch.
- **The install control is honest about what it can do.**
  `src/hooks/useInstallPrompt.ts` captures Chromium's
  `beforeinstallprompt` (which fires once, early — hence a hook, not a
  component effect that mounts too late) and `preventDefault`s it so the
  browser's own mini-infobar does not race the in-app control.
  `src/features/alerts/InstallAppPrompt.tsx` renders **nothing** unless
  the browser actually offered an install. Safari and Firefox never fire
  the event, and a button that cannot do anything is worse than no
  button. It sits above the push toggle on the dashboard because on iOS
  installing is a prerequisite for push, so the reverse order would put
  the steps backwards.
- **Already-installed detection** covers both signals: `display-mode:
  standalone` (Android/desktop) and `navigator.standalone` (the iOS-only
  equivalent Safari never replaced), plus the `appinstalled` event so an
  install completed through the browser menu still updates the UI.
- **The ONNX model artifact is excluded from precaching** on purpose. It
  is a multi-megabyte download that `docs/PROJECT_PLAN.md` §13.10 gates
  behind its own opt-in slice — not something to pull down on every first
  visit over a mobile connection.

**Critical Constants:**

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| precache cache-name prefix | `avash-precache-` | `apps/web/src/sw.js` | identifies this app's precaches so `activate` can delete superseded ones without touching unrelated caches |
| precache glob | `**/*.{js,css,html,ico,png,svg,webmanifest}` | `apps/web/vite.config.ts` | the app shell; excludes `*.onnx`, `offline.html` and `bundle-report.html` |
| offline fallback | `/offline.html` | `apps/web/src/sw.js`, `apps/web/public/offline.html` | last resort when no shell is cached |
| manifest icon sizes | 192×192, 512×512, `purpose: any maskable` | `apps/web/public/manifest.webmanifest` | Chrome's Android install criteria; maskable stops Android rendering the icon inside a white circle |
| `display` | `standalone` | `apps/web/public/manifest.webmanifest` | required for installability and for `display-mode` detection |

**Security Considerations:**

- *Cache poisoning / stale-data disclosure:* a service worker that cached
  API responses could serve a user outbreak risk data from an arbitrarily
  old session, with no visible indication it was stale. Mitigated by
  restricting cache-first strictly to the same-origin, content-hashed
  entries in the injected manifest; `/api/*` and every cross-origin
  request are passed through untouched. Asserted by
  `apps/web/e2e/pwa.spec.ts` ("leaves API requests out of the cache
  entirely") and by the unit test of the same rule.
- *Scope escalation:* the worker is served from the origin root because
  Web Push requires that scope. Its fetch handler is limited by an
  explicit origin check (`url.origin !== self.location.origin` returns
  early), so a cross-origin request whose path happens to match a
  precached one is never served from cache.
- *Open redirect via push payload:* unchanged from
  `docs/features/announcement-push.md` — notification targets are always
  constructed from a validated UUID, never taken from a payload URL
  field. Adding precaching did not touch that path, and its tests still
  cover it.
- *Offline UI misleading a user:* the shell renders offline, so a user can
  reach a page whose data cannot load. This is accepted rather than
  mitigated — the app already renders explicit error states for failed
  data loads (`docs/features/frontend-scaffold.md`), and those states are
  what an offline user sees.

**Manual Test Log:**

| Date | Test | Result |
|---|---|---|
| 2026-08-19 | `pnpm --filter web build` → precache manifest injected | 27 entries, 820 KiB; `dist/sw.js` contains no literal `__WB_MANIFEST` |
| 2026-08-19 | `apps/web/e2e/pwa.spec.ts` in Chromium against the production preview | 6/6 pass — manifest meets Android install criteria, all icons resolve, worker registers at boot, shell precached into `avash-precache-*`, no `/api/` entries cached |
| 2026-08-19 | `apps/web/src/lib/sw.test.ts` | 16/16 pass, including base-relative → absolute precache path normalization and the app-shell navigation fallback |
| 2026-08-19 | `apps/web/src/hooks/useInstallPrompt.test.ts` | 8/8 pass, including iOS `navigator.standalone` detection and single-use prompt behaviour |

Not yet verified on a physical Android device — the install criteria and
precache behaviour above are asserted in headless Chromium, which is the
same engine but not the same environment. A real-device pass belongs in
this table before the feature is called done.
