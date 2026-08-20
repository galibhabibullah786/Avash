import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { pushSubscriptionRegisterSchema } from '@avash/types';
import { fetchApi } from '../lib/apiClient';
import { env } from '../lib/env';
import { ensureServiceWorkerRegistration } from '../lib/serviceWorker';
import { supabase } from '../lib/supabaseClient';

export type PushSubscriptionStatus =
  | 'unsupported'
  /** No VAPID public key was built into this bundle — a deployment problem, not a user one. */
  | 'unconfigured'
  | 'checking'
  | 'idle'
  | 'requesting'
  | 'denied'
  | 'subscribed'
  | 'error';

export interface UsePushSubscriptionResult {
  status: PushSubscriptionStatus;
  /**
   * Requests notification permission and, if granted, registers a Web Push
   * subscription with the active service worker and POSTs it to
   * `apps/api`. Deliberately a function the caller invokes, never an
   * effect — `Notification.requestPermission()` must run in direct
   * response to a user gesture (a click handler) or most browsers refuse
   * it outright.
   */
  subscribe: () => Promise<void>;
}

// packages/types/alerts.ts freezes the request shape this route accepts
// (`pushSubscriptionRegisterSchema`) but defines no response schema — the
// route registers a row and there is nothing yet in the frozen contract
// worth asserting about its reply. `z.unknown()` keeps fetchApi's
// zod-validated-response guarantee honest without inventing a shape.
const pushSubscriptionResponseSchema = z.unknown();

/**
 * Reads the `Notification` constructor without throwing when it does not
 * exist — absent in the Vitest/jsdom environment and in some real browsers
 * (Safari on iOS < 16.4, embedded webviews, and any Safari where the page
 * has not been installed to the home screen).
 */
function readNotification(): typeof Notification | undefined {
  return typeof window !== 'undefined' ? window?.Notification : undefined;
}

/**
 * Converts the VAPID public key (base64url, as issued) into the
 * `Uint8Array` form `PushManager.subscribe()` expects.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Whether an existing browser subscription was created with the VAPID key
 * this build signs with. A subscription bound to a different key cannot
 * receive our pushes AND makes `subscribe()` reject with
 * `InvalidStateError`, so it has to be recognised in both directions.
 */
function isBoundToKey(subscription: PushSubscription | null | undefined, key: Uint8Array): boolean {
  const existingKey = subscription?.options?.applicationServerKey;
  if (!(existingKey instanceof ArrayBuffer)) {
    return false;
  }
  const existingBytes = new Uint8Array(existingKey);
  return existingBytes.length === key.length && existingBytes.every((byte, index) => byte === key[index]);
}

function toRegisterBody(subscription: PushSubscription) {
  const keys = subscription?.toJSON?.()?.keys;
  const endpoint = subscription?.endpoint;
  const p256dh = keys?.p256dh;
  const authKey = keys?.auth;
  if (!endpoint || !p256dh || !authKey) {
    return null;
  }
  return pushSubscriptionRegisterSchema.parse({ endpoint, p256dh, authKey });
}

async function registerWithServer(subscription: PushSubscription, accessToken: string): Promise<boolean> {
  const body = toRegisterBody(subscription);
  if (!body) {
    return false;
  }
  const result = await fetchApi('/api/alerts/push-subscription', pushSubscriptionResponseSchema, {
    method: 'POST',
    body,
    accessToken,
  });
  return Boolean(result?.ok);
}

/**
 * Whether this endpoint is already stored server-side, read straight from
 * Supabase under `push_subscriptions_owner_all` (RLS scopes it to the
 * caller's own rows; the SELECT grant is
 * 20260818000021_push_subscription_read_and_announcement_delivery.sql).
 *
 * A browser subscription and its server row can drift apart — the row can
 * be deleted, restored from an older backup, or removed by the batch
 * job's 410 cleanup racing a re-subscribe — and the browser would never
 * notice, because as far as IT is concerned it is still subscribed. That
 * combination is silently undeliverable forever, so it is checked rather
 * than assumed. Returns `null` when the answer can't be determined, which
 * is treated as "don't touch it" rather than "re-register".
 */
async function serverKnowsEndpoint(endpoint: string): Promise<boolean | null> {
  const { data, error } = await supabase
    ?.from('push_subscriptions')
    ?.select('id')
    ?.eq('endpoint', endpoint)
    ?.limit(1);
  if (error) {
    return null;
  }
  return (data ?? []).length > 0;
}

/**
 * Web Push subscription registration and, just as importantly, the
 * REPORTING of whether this browser is already registered.
 *
 * The status is resolved from the browser's actual state on every mount,
 * not left at a default: `Notification.permission` alone says only that
 * the user once allowed notifications, so a hook that started from it
 * showed "Enable push notifications" again after every reload even when
 * the browser held a live subscription — which is what made the control
 * look broken and pushed people into re-subscribing repeatedly.
 *
 * Every browser API access below is optional-chained (R7):
 * `navigator.serviceWorker`, `window.Notification`,
 * `registration?.pushManager`, and `subscription?.toJSON()?.keys` are all
 * legitimately absent in some real browser or in the test environment, and
 * a missing piece degrades to a status rather than throwing or sending a
 * malformed body to the server.
 */
export function usePushSubscription(accessToken: string | null): UsePushSubscriptionResult {
  const [status, setStatus] = useState<PushSubscriptionStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    const settle = (next: PushSubscriptionStatus) => {
      if (!cancelled) {
        setStatus(next);
      }
    };

    void (async () => {
      const notification = readNotification();
      if (!notification) {
        settle('unsupported');
        return;
      }
      if (!env.vapidPublicKey) {
        settle('unconfigured');
        return;
      }
      if (notification.permission === 'denied') {
        settle('denied');
        return;
      }
      if (notification.permission !== 'granted') {
        // Never granted, or revoked back to "default". Nothing to
        // reconcile, and asking for a registration here would be a
        // pointless side effect on a page the user may never act on.
        settle('idle');
        return;
      }

      try {
        const registration = await ensureServiceWorkerRegistration();
        const existing = (await registration?.pushManager?.getSubscription?.()) ?? null;
        if (!existing || !isBoundToKey(existing, urlBase64ToUint8Array(env.vapidPublicKey))) {
          // Permission is granted but there is no usable subscription —
          // the user still has to click, so this is 'idle', not 'error'.
          settle('idle');
          return;
        }

        settle('subscribed');

        // Self-heal a browser/server mismatch. Skipped when the endpoint
        // is already stored, so a page load is not a write.
        if (accessToken && (await serverKnowsEndpoint(existing.endpoint)) === false) {
          await registerWithServer(existing, accessToken);
        }
      } catch {
        settle('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const subscribe = useCallback(async () => {
    const notification = readNotification();
    if (!notification?.requestPermission) {
      setStatus('unsupported');
      return;
    }
    const vapidPublicKey = env.vapidPublicKey;
    if (!vapidPublicKey) {
      setStatus('unconfigured');
      return;
    }

    setStatus('requesting');

    let permission: NotificationPermission;
    try {
      permission = await notification.requestPermission();
    } catch {
      setStatus('error');
      return;
    }

    if (permission !== 'granted') {
      setStatus('denied');
      return;
    }

    try {
      // Registers `src/sw.js` on demand rather than assuming one is
      // already there. `main.tsx` also registers it at boot, so this is
      // usually a no-op that resolves the existing registration.
      const registration = await ensureServiceWorkerRegistration();
      const pushManager = registration?.pushManager;
      if (!pushManager?.subscribe) {
        setStatus('error');
        return;
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      // A subscription already bound to a DIFFERENT VAPID key makes
      // subscribe() reject with InvalidStateError, so it has to go before
      // a new one can be created. One bound to the SAME key is kept:
      // re-subscribing would mint a fresh endpoint and orphan the
      // push_subscriptions row holding the old one.
      const existing = (await pushManager.getSubscription?.()) ?? null;
      const keyMatches = isBoundToKey(existing, applicationServerKey);

      if (existing && !keyMatches) {
        await existing.unsubscribe?.();
      }

      const subscription =
        existing && keyMatches
          ? existing
          : await pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey,
            });

      if (!accessToken) {
        setStatus('error');
        return;
      }

      setStatus((await registerWithServer(subscription, accessToken)) ? 'subscribed' : 'error');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  return { status, subscribe };
}
