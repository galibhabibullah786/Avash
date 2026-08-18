import { useCallback, useState } from 'react';
import { z } from 'zod';
import { pushSubscriptionRegisterSchema } from '@avash/types';
import { fetchApi } from '../lib/apiClient';
import { ensureServiceWorkerRegistration } from '../lib/serviceWorker';

export type PushSubscriptionStatus =
  | 'unsupported'
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
 * (Safari on iOS < 16.4, embedded webviews).
 */
function readNotification(): typeof Notification | undefined {
  return typeof window !== 'undefined' ? window?.Notification : undefined;
}

function initialStatus(): PushSubscriptionStatus {
  const notification = readNotification();
  if (!notification) {
    return 'unsupported';
  }
  return notification?.permission === 'denied' ? 'denied' : 'idle';
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
 * Web Push subscription registration. Every browser API access below is
 * optional-chained (R7): `navigator.serviceWorker`, `window.Notification`,
 * `registration?.pushManager`, and `subscription?.toJSON()?.keys` are all
 * legitimately absent in some real browser or in the test environment, and
 * a missing piece degrades to `status: 'error'` rather than throwing or
 * sending a malformed body to the server.
 */
export function usePushSubscription(accessToken: string | null): UsePushSubscriptionResult {
  const [status, setStatus] = useState<PushSubscriptionStatus>(initialStatus);

  const subscribe = useCallback(async () => {
    const notification = readNotification();
    if (!notification?.requestPermission) {
      setStatus('unsupported');
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

    const vapidPublicKey = import.meta.env.VITE_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setStatus('error');
      return;
    }

    try {
      // Registers `public/sw.js` on demand rather than assuming one is
      // already there: `getRegistration()` alone resolved to undefined on
      // every first visit, which is what made this whole path unreachable
      // — there was no worker, and nothing registered one.
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
      const existing = await pushManager.getSubscription?.();
      const existingKey = existing?.options?.applicationServerKey;
      const keyMatches =
        existingKey instanceof ArrayBuffer &&
        new Uint8Array(existingKey).length === applicationServerKey.length &&
        new Uint8Array(existingKey).every((byte, index) => byte === applicationServerKey[index]);

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

      const keys = subscription?.toJSON?.()?.keys;
      const endpoint = subscription?.endpoint;
      const p256dh = keys?.p256dh;
      const authKey = keys?.auth;

      if (!endpoint || !p256dh || !authKey) {
        setStatus('error');
        return;
      }

      const body = pushSubscriptionRegisterSchema.parse({ endpoint, p256dh, authKey });

      const result = await fetchApi('/api/alerts/push-subscription', pushSubscriptionResponseSchema, {
        method: 'POST',
        body,
        ...(accessToken ? { accessToken } : {}),
      });

      setStatus(result?.ok ? 'subscribed' : 'error');
    } catch {
      setStatus('error');
    }
  }, [accessToken]);

  return { status, subscribe };
}
