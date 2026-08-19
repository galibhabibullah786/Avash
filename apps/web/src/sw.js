/**
 * Service worker for Web Push delivery.
 *
 * Web Push has no in-page delivery path: the browser wakes a service
 * worker to handle the `push` event whether or not a tab is open, so
 * without this file `PushManager.subscribe()` has nothing to attach to and
 * the whole feature is unreachable — `navigator.serviceWorker
 * .getRegistration()` resolves to undefined and `usePushSubscription`
 * degrades to `status: 'error'`.
 *
 * This is NOT a WebSocket or any other persistent connection the app
 * holds open. The push travels from `ml/serving/push_delivery.py` to the
 * browser vendor's push service (signed with the VAPID private key) and
 * from there to this worker; the app itself may be closed entirely.
 *
 * BUILT, NOT SERVED RAW. This file lives in `src/`, not `public/`, and is
 * compiled by vite-plugin-pwa's `injectManifest` strategy
 * (docs/PROJECT_PLAN.md §1). It is still a CLASSIC worker script with no
 * `import` statements — the one thing the build adds is
 * `self.__WB_MANIFEST`, the content-hashed list of every build artifact,
 * which is the only way a service worker can know what "the current app
 * shell" consists of. Keep it import-free: `src/lib/sw.test.ts` loads this
 * source into a `vm` sandbox to exercise the handlers directly, and an ESM
 * import would end that.
 *
 * The fetch handler serves navigations app-shell-first from the precache
 * and falls back to `public/offline.html`; every non-navigation request
 * is served cache-first ONLY if it is a precached build asset, and passes
 * through untouched otherwise. API calls, Supabase requests and tiles are
 * never cached here — see the fetch handler's own comments.
 */

const OFFLINE_URL = '/offline.html';

/**
 * Version-scoped by the build. `self.__WB_MANIFEST` changes whenever any
 * build artifact changes, so hashing it into the cache name means a
 * deploy lands in a NEW cache and the activate handler below deletes the
 * old one — rather than a stale asset surviving indefinitely under a
 * fixed key, which is the classic way a precaching service worker pins
 * users to a version that no longer exists on the server.
 */
const PRECACHE_ENTRIES = self.__WB_MANIFEST ?? [];

/**
 * Workbox emits manifest urls RELATIVE to the build base
 * (`index.html`, `assets/x-hash.js`), while `fetch` events carry absolute
 * ones and `URL.pathname` is always rooted. Comparing the two directly
 * matches nothing — every lookup misses, the precache is written but
 * never read, and the whole thing degrades silently to network-only.
 * Resolving against the worker's own scope normalizes both sides and
 * keeps this correct if the app is ever served from a sub-path.
 */
function toScopedPath(url) {
  try {
    return new URL(url, self.registration?.scope ?? self.location.origin).pathname;
  } catch {
    return null;
  }
}

function precacheCacheName() {
  const revisions = PRECACHE_ENTRIES.map((entry) => `${entry?.url ?? ''}@${entry?.revision ?? ''}`)
    .sort()
    .join('|');
  // djb2 — a hash, not a security primitive: this only has to change when
  // the asset list changes, and SubtleCrypto is async and unavailable to
  // a synchronous module-scope initializer.
  let hash = 5381;
  for (let i = 0; i < revisions.length; i += 1) {
    hash = ((hash << 5) + hash + revisions.charCodeAt(i)) | 0;
  }
  return `avash-precache-${(hash >>> 0).toString(36)}`;
}

const OFFLINE_CACHE = precacheCacheName();

/** Same-origin paths the precache is responsible for, for O(1) fetch-time lookup. */
const PRECACHED_PATHS = new Set(
  PRECACHE_ENTRIES.map((entry) => toScopedPath(entry?.url)).filter(Boolean)
);

/** The SPA app shell — every client-side route resolves to this document. */
const APP_SHELL_PATH = toScopedPath('index.html') ?? '/index.html';

/**
 * `fetch` + `cache.put`, deliberately not `cache.add`/`addAll`: Chrome
 * rejects `add()` here with `InvalidAccessError: Entry already exists`
 * (observed, not theorised), which left the cache empty and the offline
 * fallback dead while the install still reported success. `put` takes a
 * response this code already holds, so a failure is visible rather than
 * swallowed by the helper.
 *
 * `addAll` is additionally wrong for the app shell: it is atomic, so one
 * asset 404ing during a deploy rollover discards the entire precache and
 * leaves the worker with nothing. Each entry is put independently and a
 * failure is tolerated — a partially warm cache degrades to a network
 * fetch for the missing asset, which is exactly the behaviour that
 * existed before precaching.
 */
async function precacheOne(cache, url) {
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (response?.ok) {
      await cache.put(url, response);
    }
  } catch {
    // Deliberately swallowed — see the addAll note above.
  }
}

async function precacheAppShell() {
  const cache = await caches.open(OFFLINE_CACHE);
  // The offline page is not part of __WB_MANIFEST (it is a public/ asset
  // the app never imports, so nothing in the build graph references it),
  // but it is the last-resort navigation fallback and must be present.
  const urls = new Set([OFFLINE_URL, ...PRECACHED_PATHS]);
  await Promise.all([...urls].map((url) => precacheOne(cache, url)));
}

// A newly installed worker would otherwise sit in "waiting" until every
// tab closes, so a subscriber who reloads still runs the old handler.
self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAppShell()
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key))))
      .catch(() => undefined)
      .then(() => self.clients.claim())
  );
});

/**
 * Cache-first for precached BUILD ASSETS ONLY (`/assets/*.js`, CSS,
 * icons) — everything in `__WB_MANIFEST` is content-hashed, so a cache
 * hit can never be stale: a changed file is a different URL. This is what
 * makes the installed app open instantly and work offline.
 *
 * Everything else — `/api/*`, Supabase, OSM tiles, anything
 * cross-origin — is deliberately NOT handled. Returning a cached API
 * response would show a user stale outbreak risk data, which for this
 * application is worse than showing them an error.
 */
function isPrecachedAsset(request) {
  if (request?.method !== 'GET') return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  return PRECACHED_PATHS.has(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event?.request;

  if (isPrecachedAsset(request)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request))
    );
    return;
  }

  // Navigations. API calls, Supabase requests and third-party assets are
  // left entirely alone — an offline page served in place of a failed
  // fetch() would be far worse than the failure itself.
  if (request?.mode !== 'navigate') {
    return;
  }
  event.respondWith(
    fetch(request).catch(async () => {
      // App-shell fallback FIRST. This is a client-rendered SPA: every
      // route is served by the same index.html, so a precached index.html
      // can render the real application offline (the router and the
      // React Query cache take over from there). Falling straight to
      // offline.html would show a dead-end page for a deep link the app
      // is perfectly capable of rendering.
      const shell = await caches.match(APP_SHELL_PATH);
      if (shell) {
        return shell;
      }
      const cached = await caches.match(OFFLINE_URL);
      // Always a real Response, never Response.error(): the browser
      // renders its own network-error page for a rejected navigation,
      // which is the exact outcome this handler exists to replace. If
      // the precache did not survive, an inline page still beats that.
      return (
        cached ??
        new Response(
          '<!doctype html><html lang="en"><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Offline — Avash</title>' +
            '<body style="font-family:system-ui;background:#0b1220;color:#f5f7fa;display:grid;' +
            'place-items:center;height:100vh;margin:0;text-align:center">' +
            '<main><h1>You are offline</h1><p>Reconnect and try again.</p></main>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      );
    })
  );
});

// Mirrors packages/types/alerts.ts's UUID validation (z.string().uuid())
// — sw.js is a raw public/ asset and cannot import that package, so this
// is hand-copied. Keep in sync with that file.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches the payload `ml/serving/predict.py` builds for a region crossing into high/severe risk. */
const RISK_FALLBACK = {
  title: 'Avash alert',
  body: 'There is a new dengue risk alert for your area.',
  url: '/dashboard',
  tag: 'avash-risk-alert',
};

/**
 * Mirrors `announcementPushPayloadSchema` from packages/types/alerts.ts
 * BY HAND — sw.js is a raw public/ asset and cannot import that package.
 * If that schema ever changes, this function needs a matching edit in
 * the same commit.
 *
 * `{ kind: 'announcement', title, body, announcementId }`
 */
function readAnnouncementPayload(data) {
  const announcementId = typeof data?.announcementId === 'string' ? data.announcementId : '';
  if (!UUID_PATTERN.test(announcementId)) {
    // A malformed/missing id falls back to the generic dashboard route —
    // never trust the shape of push data past this point.
    return {
      title: typeof data?.title === 'string' && data.title ? data.title : RISK_FALLBACK.title,
      body: typeof data?.body === 'string' && data.body ? data.body : RISK_FALLBACK.body,
      url: '/dashboard',
      tag: RISK_FALLBACK.tag,
    };
  }
  return {
    title: typeof data?.title === 'string' && data.title ? data.title : RISK_FALLBACK.title,
    body: typeof data?.body === 'string' && data.body ? data.body : RISK_FALLBACK.body,
    // Built HERE from a validated UUID, never taken directly from any URL
    // field the payload might carry — same open-redirect defence as the
    // risk-alert path below, extended to this payload kind.
    url: `/dashboard?announcement=${announcementId}`,
    // Distinct per announcement so two announcements published minutes
    // apart don't collapse into one notification in the tray; repeat
    // deliveries of the SAME announcement (at-least-once delivery) still
    // collapse via renotify below.
    tag: `avash-announcement-${announcementId}`,
  };
}

function readPayload(event) {
  try {
    const data = event?.data?.json?.();
    if (!data || typeof data !== 'object') {
      return RISK_FALLBACK;
    }
    if (data.kind === 'announcement') {
      return readAnnouncementPayload(data);
    }
    return {
      title: typeof data.title === 'string' && data.title ? data.title : RISK_FALLBACK.title,
      body: typeof data.body === 'string' && data.body ? data.body : RISK_FALLBACK.body,
      // Only ever a same-origin path, never a URL from the payload — a
      // push message is attacker-controlled input if the VAPID key ever
      // leaks, and `notificationclick` opening an arbitrary origin would
      // turn that into an open redirect.
      url: typeof data.regionCode === 'string' && data.regionCode ? '/risk' : RISK_FALLBACK.url,
      tag: RISK_FALLBACK.tag,
    };
  } catch {
    return RISK_FALLBACK;
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  // `userVisibleOnly: true` was set at subscribe time, so a push that
  // shows no notification costs the app its push permission in Chrome —
  // waitUntil keeps the worker alive until showNotification resolves.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Per-announcement tag (or the shared risk-alert tag) collapses
      // repeat deliveries of the SAME thing into one notification, while
      // distinct announcements/alerts still stack as separate entries.
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification?.close?.();
  const target = event.notification?.data?.url ?? '/dashboard';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an already-open tab rather than opening a duplicate.
        for (const client of clientList) {
          if (client?.url && new URL(client.url).origin === self.location.origin && client.focus) {
            return client.focus().then(() => {
              // Preferred path: hand the target to the page over
              // postMessage so an already-open SPA tab does a client-side
              // route change (SessionProvider/query cache stay intact)
              // instead of `client.navigate()`'s full document reload,
              // which would blow away all React state.
              if (typeof client.postMessage === 'function') {
                client.postMessage({ type: 'avash:navigate', url: target });
                return undefined;
              }
              // Fallback for a client that can't receive messages —
              // unchanged from the original behaviour.
              return client.navigate?.(target);
            });
          }
        }
        return self.clients.openWindow?.(target);
      })
      .catch(() => undefined)
  );
});
