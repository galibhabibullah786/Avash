/**
 * RFC 8291 (`aes128gcm`) payload encryption + RFC 8292 VAPID signing, on
 * WebCrypto only — no `node:crypto` — so this stays portable to Deno and
 * workerd (ADR-016 decision B).
 *
 * Delegates the actual crypto to `web-push-neo`, a small WebCrypto-only
 * library (its own dependency, `jose`, is likewise WebCrypto-based and
 * ships workerd/Deno-safe conditional exports — no `node:crypto` anywhere
 * in this module's dependency graph). Chosen over the more widely used
 * `web-push` package because that one is hard-wired to `node:crypto`, and
 * over `@block65/webcrypto-web-push` / `webpush-webcrypto` /
 * `@pushforge/builder` because all three still emit the OLD
 * `Content-Encoding: aesgcm` draft, not the RFC 8291 `aes128gcm` this
 * module is required to speak — verified by reading each candidate's
 * source before picking one, not by trusting its README.
 */
import {
  generateRequestDetails,
  sendNotification,
  WebPushError,
  type PushSubscription as NeoPushSubscription,
  type VapidDetails as NeoVapidDetails,
} from 'web-push-neo';

export interface WebPushSubscription {
  endpoint: string;
  p256dh: string;
  authKey: string;
}

export interface WebPushVapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface SendWebPushOptions {
  subscription: WebPushSubscription;
  payload: unknown;
  /** Seconds. No default — see PUSH_TTL_SECONDS in ml/serving/push_delivery.py for why TTL 0 is unsafe. */
  ttlSeconds: number;
  vapid: WebPushVapidConfig;
}

export type SendWebPushResult =
  | { outcome: 'sent'; statusCode: number }
  | { outcome: 'gone'; statusCode: 410 }
  | { outcome: 'failed'; statusCode: number };

function assertValidOptions(
  subscription: WebPushSubscription | undefined,
  vapid: WebPushVapidConfig | undefined,
  ttlSeconds: number | undefined,
  callerName: string,
): asserts subscription is WebPushSubscription {
  if (
    !subscription?.endpoint ||
    typeof subscription.endpoint !== 'string' ||
    !subscription?.p256dh ||
    !subscription?.authKey
  ) {
    throw new Error(`${callerName}: subscription is missing endpoint/p256dh/authKey`);
  }
  if (!vapid?.publicKey || !vapid?.privateKey || !vapid?.subject) {
    throw new Error(`${callerName}: vapid config is missing publicKey/privateKey/subject`);
  }
  if (!Number.isFinite(ttlSeconds) || (ttlSeconds ?? 0) <= 0) {
    // Deliberately no default — ttlSeconds=0 tells the push service
    // "deliver this instant or discard it", which silently drops every
    // notification to an offline device and is outright rejected (400)
    // by Windows' push service. Callers must compute a real TTL.
    throw new Error(`${callerName}: ttlSeconds must be a positive number, got ${String(ttlSeconds)}`);
  }
}

export async function sendWebPush(options: SendWebPushOptions): Promise<SendWebPushResult> {
  const subscription = options?.subscription;
  const vapid = options?.vapid;
  const ttlSeconds = options?.ttlSeconds;
  assertValidOptions(subscription, vapid, ttlSeconds, 'sendWebPush');

  const neoSubscription: NeoPushSubscription = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.authKey },
  };
  const vapidDetails: NeoVapidDetails = {
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };

  const payloadJson = JSON.stringify(options.payload ?? {});

  try {
    const result = await sendNotification(neoSubscription, payloadJson, {
      TTL: ttlSeconds,
      vapidDetails,
    });
    return { outcome: 'sent', statusCode: result?.statusCode ?? 201 };
  } catch (err) {
    if (err instanceof WebPushError) {
      const statusCode = err.statusCode;
      if (statusCode === 410) {
        return { outcome: 'gone', statusCode: 410 };
      }
      return { outcome: 'failed', statusCode: statusCode ?? 0 };
    }
    // Any other failure (network error, DNS, etc.) — never surfaced as a
    // thrown exception here so a caller fanning out over many
    // subscriptions can treat every outcome uniformly, and never carries
    // the raw underlying error message (which could, in principle,
    // originate from a library that echoes call arguments) into a
    // returned value. `0` signals "no HTTP response was ever received",
    // distinct from a real HTTP status.
    return { outcome: 'failed', statusCode: 0 };
  }
}

/**
 * Exposed for callers that need the raw request (endpoint/method/headers/
 * body) without sending it — used by this package's own tests to assert
 * on the VAPID `Authorization` header and `TTL` header without needing a
 * live push service. Thin passthrough to `web-push-neo`, kept here so
 * nothing outside this module imports `web-push-neo` directly.
 */
export async function buildWebPushRequest(options: SendWebPushOptions): Promise<{
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}> {
  const subscription = options?.subscription;
  const vapid = options?.vapid;
  const ttlSeconds = options?.ttlSeconds;
  assertValidOptions(subscription, vapid, ttlSeconds, 'buildWebPushRequest');

  const neoSubscription: NeoPushSubscription = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.authKey },
  };
  return generateRequestDetails(neoSubscription, JSON.stringify(options.payload ?? {}), {
    TTL: ttlSeconds,
    vapidDetails: {
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
  });
}
