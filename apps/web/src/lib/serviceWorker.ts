/** Served from `apps/web/public/`, so it lands at the origin root in both dev and build — the scope Web Push needs. */
export const SERVICE_WORKER_URL = '/sw.js';

/**
 * Registers `public/sw.js` if it isn't already, and resolves only once a
 * worker is actually ACTIVE for this origin.
 *
 * `PushManager.subscribe()` needs an active worker, and a freshly
 * registered one spends a moment in `installing` — subscribing against
 * that window is the difference between a working subscription and a
 * silent failure. `navigator.serviceWorker.ready` is what waits for
 * activation, but it never settles when nothing is registered, so it is
 * only awaited after a registration exists.
 *
 * Returns null rather than throwing on any unsupported/blocked path
 * (`navigator.serviceWorker` is absent over plain HTTP on a non-localhost
 * origin, in some webviews, and in the jsdom test environment) so callers
 * can degrade rather than break.
 */
export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  const container = typeof navigator !== 'undefined' ? navigator?.serviceWorker : undefined;
  if (!container?.register) {
    return null;
  }

  try {
    const existing = await container.getRegistration?.();
    const registration = existing ?? (await container.register(SERVICE_WORKER_URL));
    if (!registration) {
      return null;
    }
    if (!registration.active) {
      await container.ready;
    }
    return (await container.getRegistration?.()) ?? registration;
  } catch {
    return null;
  }
}

/** The message shape `sw.js`'s `notificationclick` handler posts back to the page. */
export const SERVICE_WORKER_NAVIGATE_MESSAGE_TYPE = 'avash:navigate';

/**
 * Wires up `navigator.serviceWorker`'s `message` event so an
 * `avash:navigate` message from `sw.js` (sent when a subscriber clicks a
 * notification while this tab is already open and focused) drives React
 * Router's imperative navigation instead of the full document reload
 * `client.navigate()` would have caused. Every field on the incoming
 * message is untrusted (R4) — checked before use, ignored otherwise.
 *
 * Returns a cleanup function that removes the listener; safe to call even
 * when `navigator.serviceWorker` doesn't exist (no-op cleanup).
 */
export function listenForServiceWorkerNavigation(navigate: (url: string) => void): () => void {
  const container = typeof navigator !== 'undefined' ? navigator?.serviceWorker : undefined;
  if (!container?.addEventListener) {
    return () => undefined;
  }

  const handler = (event: MessageEvent) => {
    const data = event?.data as { type?: unknown; url?: unknown } | undefined;
    if (data?.type === SERVICE_WORKER_NAVIGATE_MESSAGE_TYPE && typeof data.url === 'string' && data.url) {
      navigate(data.url);
    }
  };

  container.addEventListener('message', handler);
  return () => container.removeEventListener?.('message', handler);
}
