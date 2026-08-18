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
 * The fetch handler below is deliberately minimal: a navigation that the
 * network cannot serve falls back to `public/offline.html`, and every
 * other request passes through untouched. It is NOT the Workbox
 * precaching strategy docs/PROJECT_PLAN.md §10 describes for the offline
 * ONNX/model-snapshot feature — that is a separate piece of work, and
 * quietly caching every asset here would change what the whole app
 * resolves to. It exists because a browser will not offer to install a
 * PWA without a fetch handler, and on iOS/iPadOS an installed app is the
 * only place Web Push works at all.
 */

const OFFLINE_URL = '/offline.html';
const OFFLINE_CACHE = 'avash-offline-v1';

/**
 * `fetch` + `cache.put`, deliberately not `cache.add`: Chrome rejects
 * `add()` here with `InvalidAccessError: Entry already exists` (observed,
 * not theorised), which left the cache empty and the offline fallback
 * dead while the install still reported success. `put` takes a response
 * this code already holds, so a failure is visible in the status check
 * rather than swallowed by the helper.
 */
async function precacheOfflinePage() {
  const cache = await caches.open(OFFLINE_CACHE);
  const response = await fetch(OFFLINE_URL, { cache: 'reload' });
  if (response?.ok) {
    await cache.put(OFFLINE_URL, response);
  }
}

// A newly installed worker would otherwise sit in "waiting" until every
// tab closes, so a subscriber who reloads still runs the old handler.
self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheOfflinePage()
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

self.addEventListener('fetch', (event) => {
  // Navigations only. API calls, Supabase requests and static assets are
  // left entirely alone — an offline page served in place of a failed
  // fetch() would be far worse than the failure itself.
  if (event.request?.mode !== 'navigate') {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(async () => {
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

/** Matches the payload `ml/serving/predict.py` builds for a region crossing into high/severe risk. */
function readPayload(event) {
  const fallback = {
    title: 'Avash alert',
    body: 'There is a new dengue risk alert for your area.',
    url: '/dashboard',
  };
  try {
    const data = event?.data?.json?.();
    if (!data || typeof data !== 'object') {
      return fallback;
    }
    return {
      title: typeof data.title === 'string' && data.title ? data.title : fallback.title,
      body: typeof data.body === 'string' && data.body ? data.body : fallback.body,
      // Only ever a same-origin path, never a URL from the payload — a
      // push message is attacker-controlled input if the VAPID key ever
      // leaks, and `notificationclick` opening an arbitrary origin would
      // turn that into an open redirect.
      url: typeof data.regionCode === 'string' && data.regionCode ? '/risk' : fallback.url,
    };
  } catch {
    return fallback;
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
      // Collapses repeat alerts into one notification rather than
      // stacking one per batch run.
      tag: 'avash-risk-alert',
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
            return client.focus().then(() => client.navigate?.(target));
          }
        }
        return self.clients.openWindow?.(target);
      })
      .catch(() => undefined)
  );
});
