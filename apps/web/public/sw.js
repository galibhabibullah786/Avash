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
 * Deliberately no offline/caching strategy here. `public/offline.html`
 * exists but nothing has ever registered a worker to serve it, and adding
 * a fetch handler would change what every request in the app resolves to
 * — a separate decision from making push work.
 */

// A newly installed worker would otherwise sit in "waiting" until every
// tab closes, so a subscriber who reloads still runs the old handler.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
