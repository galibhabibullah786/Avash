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
