/**
 * RFC 8291 (`aes128gcm`) payload encryption + RFC 8292 VAPID signing, on
 * WebCrypto only — no `node:crypto` — so this stays portable to Deno and
 * workerd (ADR-016 decision B). Implemented in A-T01.
 */

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

export async function sendWebPush(_options: SendWebPushOptions): Promise<SendWebPushResult> {
  throw new Error('not implemented');
}
