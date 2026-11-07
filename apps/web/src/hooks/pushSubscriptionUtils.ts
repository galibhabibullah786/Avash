import { z } from "zod";
import { pushSubscriptionRegisterSchema } from "@avash/types";
import { fetchApi } from "../lib/apiClient";
import { supabase } from "../lib/supabaseClient";

export type PushSubscriptionStatus =
  | "unsupported"
  /** No VAPID public key was built into this bundle — a deployment problem, not a user one. */
  | "unconfigured"
  | "checking"
  | "idle"
  | "requesting"
  | "denied"
  | "subscribed"
  | "error";

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
export function readNotification(): typeof Notification | undefined {
  return typeof window !== "undefined" ? window?.Notification : undefined;
}

/**
 * Converts the VAPID public key (base64url, as issued) into the
 * `Uint8Array` form `PushManager.subscribe()` expects.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
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
export function isBoundToKey(
  subscription: PushSubscription | null | undefined,
  key: Uint8Array,
): boolean {
  const existingKey = subscription?.options?.applicationServerKey;
  if (!(existingKey instanceof ArrayBuffer)) {
    return false;
  }
  const existingBytes = new Uint8Array(existingKey);
  return (
    existingBytes.length === key.length &&
    existingBytes.every((byte, index) => byte === key[index])
  );
}

export function toRegisterBody(subscription: PushSubscription) {
  const keys = subscription?.toJSON?.()?.keys;
  const endpoint = subscription?.endpoint;
  const p256dh = keys?.p256dh;
  const authKey = keys?.auth;
  if (!endpoint || !p256dh || !authKey) {
    return null;
  }
  return pushSubscriptionRegisterSchema.parse({ endpoint, p256dh, authKey });
}

export async function registerWithServer(
  subscription: PushSubscription,
  accessToken: string,
): Promise<boolean> {
  const body = toRegisterBody(subscription);
  if (!body) {
    return false;
  }
  const result = await fetchApi(
    "/api/alerts/push-subscription",
    pushSubscriptionResponseSchema,
    {
      method: "POST",
      body,
      accessToken,
    },
  );
  return Boolean(result?.ok);
}

/**
 * Whether this endpoint is already stored server-side, read straight from
 * Supabase under `push_subscriptions_owner_all` (RLS scopes it to the
 * caller's own rows; the SELECT grant is
 * 20260818000021_push_subscription_read_and_announcement_delivery.sql).
 */
export async function serverKnowsEndpoint(
  endpoint: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    ?.from("push_subscriptions")
    ?.select("id")
    ?.eq("endpoint", endpoint)
    ?.limit(1);
  if (error) {
    return null;
  }
  return (data ?? []).length > 0;
}
