import { useCallback, useEffect, useState } from "react";
import { env } from "../lib/env";
import { ensureServiceWorkerRegistration } from "../lib/serviceWorker";
import {
  readNotification,
  urlBase64ToUint8Array,
  isBoundToKey,
  registerWithServer,
  serverKnowsEndpoint,
  type PushSubscriptionStatus,
  type UsePushSubscriptionResult,
} from "./pushSubscriptionUtils";

export type { PushSubscriptionStatus, UsePushSubscriptionResult };

/**
 * Web Push subscription registration and reporting of browser state.
 */
export function usePushSubscription(
  accessToken: string | null,
): UsePushSubscriptionResult {
  const [status, setStatus] = useState<PushSubscriptionStatus>("checking");

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
        settle("unsupported");
        return;
      }
      if (!env.vapidPublicKey) {
        settle("unconfigured");
        return;
      }
      if (notification.permission === "denied") {
        settle("denied");
        return;
      }
      if (notification.permission !== "granted") {
        settle("idle");
        return;
      }

      try {
        const registration = await ensureServiceWorkerRegistration();
        const existing =
          (await registration?.pushManager?.getSubscription?.()) ?? null;
        if (
          !existing ||
          !isBoundToKey(existing, urlBase64ToUint8Array(env.vapidPublicKey))
        ) {
          settle("idle");
          return;
        }

        settle("subscribed");

        if (
          accessToken &&
          (await serverKnowsEndpoint(existing.endpoint)) === false
        ) {
          await registerWithServer(existing, accessToken);
        }
      } catch {
        settle("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const subscribe = useCallback(async () => {
    const notification = readNotification();
    if (!notification?.requestPermission) {
      setStatus("unsupported");
      return;
    }
    const vapidPublicKey = env.vapidPublicKey;
    if (!vapidPublicKey) {
      setStatus("unconfigured");
      return;
    }

    setStatus("requesting");

    let permission: NotificationPermission;
    try {
      permission = await notification.requestPermission();
    } catch {
      setStatus("error");
      return;
    }

    if (permission !== "granted") {
      setStatus("denied");
      return;
    }

    try {
      const registration = await ensureServiceWorkerRegistration();
      const pushManager = registration?.pushManager;
      if (!pushManager?.subscribe) {
        setStatus("error");
        return;
      }

      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
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
        setStatus("error");
        return;
      }

      setStatus(
        (await registerWithServer(subscription, accessToken))
          ? "subscribed"
          : "error",
      );
    } catch {
      setStatus("error");
    }
  }, [accessToken]);

  return { status, subscribe };
}
