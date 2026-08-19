import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ANNOUNCEMENT_PUSH_BATCH_SIZE,
  ANNOUNCEMENT_PUSH_CONCURRENCY,
  ANNOUNCEMENT_PUSH_LEASE_SECONDS,
  type AnnouncementPushResult,
} from '@avash/types';
import { sendWebPush, type WebPushVapidConfig } from './webPush';

/**
 * The whole delivery pass for one announcement, host-agnostic: claim with
 * a lease, call `announcement_push_targets`, fan out, handle `410`s, stamp
 * `pushed_at`. See docs/features/announcement-push.md for the exact
 * sequence and ADR-016 for why the claim exists at all (two triggers —
 * a Supabase Database Webhook and an Inngest sweep — can race on the
 * same announcement).
 */
export interface DeliverAnnouncementOptions {
  supabase: SupabaseClient;
  announcementId: string;
  vapid: WebPushVapidConfig;
}

/**
 * Ceiling for a push's TTL, mirroring `PUSH_TTL_SECONDS` in
 * `ml/serving/push_delivery.py` (24h — matches that job's batch cadence
 * reasoning: comfortably inside every push service's own ceiling, FCM 4
 * weeks / WNS 30 days). The actual TTL sent is the lesser of this and the
 * announcement's own remaining lifetime, floored at 1 — never 0, which
 * every push service interprets as "deliver this instant or discard".
 */
const ANNOUNCEMENT_PUSH_TTL_CEILING_SECONDS = 86_400;

interface ClaimedAnnouncement {
  id: string;
  title: string;
  body: string;
  expiresAt: string | null;
}

interface PushTargetRow {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

/** Whole seconds remaining until `expiresAt`, clamped to [1, ceiling]. */
function secondsUntil(expiresAt: string | null | undefined, ceilingSeconds: number): number {
  if (!expiresAt) return ceilingSeconds;
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return ceilingSeconds;
  const remaining = Math.floor((expiryMs - Date.now()) / 1000);
  return Math.max(1, Math.min(remaining, ceilingSeconds));
}

/** Splits `items` into chunks of at most `size` — A-T02's `ANNOUNCEMENT_PUSH_BATCH_SIZE`. */
function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once — a plain
 * semaphore, no new dependency needed for `ANNOUNCEMENT_PUSH_CONCURRENCY`.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Step 1: claim the announcement before sending anything. No row
 * returned means someone else (the webhook or the sweep, racing this
 * same call) already holds the lease or already delivered — the caller
 * stops rather than double-sending.
 */
async function claimAnnouncement(
  supabase: SupabaseClient,
  announcementId: string,
): Promise<ClaimedAnnouncement | null> {
  const nowIso = new Date().toISOString();
  const leaseCutoffIso = new Date(Date.now() - ANNOUNCEMENT_PUSH_LEASE_SECONDS * 1000).toISOString();

  const { data, error } = await supabase
    .from('announcements')
    .update({ push_claimed_at: nowIso })
    .eq('id', announcementId)
    .is('pushed_at', null)
    .or(`push_claimed_at.is.null,push_claimed_at.lt.${leaseCutoffIso}`)
    .select('id, title, body, expires_at');

  if (error) {
    throw new Error(`deliverAnnouncement: claim failed for ${announcementId}: ${error.message ?? 'unknown error'}`);
  }

  const row = data?.[0] as
    | { id?: string; title?: string | null; body?: string | null; expires_at?: string | null }
    | undefined;
  if (!row?.id) return null;
  return {
    id: row.id,
    title: row.title ?? '',
    body: row.body ?? '',
    expiresAt: row.expires_at ?? null,
  };
}

/** Step 2: resolve the announcement to its push targets via the RPC (already role/radius-correct). */
async function fetchPushTargets(
  supabase: SupabaseClient,
  announcementId: string,
): Promise<PushTargetRow[]> {
  const { data, error } = await supabase.rpc('announcement_push_targets', {
    p_announcement_id: announcementId,
  });
  if (error) {
    throw new Error(
      `deliverAnnouncement: announcement_push_targets RPC failed for ${announcementId}: ${error.message ?? 'unknown error'}`,
    );
  }
  const rows = (data ?? []) as PushTargetRow[];
  return rows.filter(
    (row) => !!row?.subscription_id && !!row?.endpoint && !!row?.p256dh && !!row?.auth_key,
  );
}

interface SendOneOutcome {
  outcome: 'sent' | 'gone' | 'failed';
}

/**
 * Sends to one target. A `410 Gone` deletes that `push_subscriptions` row
 * immediately, no retry. Any other failure is logged (status + subscription
 * id only — never the response body, which could carry PII or push-service
 * internals) and the batch continues; one bad subscription must never
 * abort the rest.
 */
async function sendToOneTarget(
  supabase: SupabaseClient,
  target: PushTargetRow,
  payload: unknown,
  ttlSeconds: number,
  vapid: WebPushVapidConfig,
): Promise<SendOneOutcome> {
  const subscriptionId = target?.subscription_id;
  try {
    const result = await sendWebPush({
      subscription: {
        endpoint: target?.endpoint,
        p256dh: target?.p256dh,
        authKey: target?.auth_key,
      },
      payload,
      ttlSeconds,
      vapid,
    });

    if (result.outcome === 'gone') {
      if (subscriptionId) {
        const { error: deleteError } = await supabase
          .from('push_subscriptions')
          .delete()
          .eq('id', subscriptionId);
        if (deleteError) {
          console.warn(
            `deliverAnnouncement: failed to delete gone subscription ${subscriptionId}: ${deleteError.message ?? 'unknown error'}`,
          );
        }
      }
      return { outcome: 'gone' };
    }

    if (result.outcome === 'failed') {
      console.warn(`deliverAnnouncement: push failed (status=${result.statusCode}) for subscription ${subscriptionId}`);
      return { outcome: 'failed' };
    }

    return { outcome: 'sent' };
  } catch (err) {
    // sendWebPush only throws for malformed input (never for a send
    // failure), but a malformed RPC row must not abort the batch any
    // more than a malformed HTTP response would.
    console.warn(
      `deliverAnnouncement: unexpected error sending to subscription ${subscriptionId}: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return { outcome: 'failed' };
  }
}

export async function deliverAnnouncement(
  options: DeliverAnnouncementOptions,
): Promise<AnnouncementPushResult> {
  const supabase = options?.supabase;
  const announcementId = options?.announcementId;
  const vapid = options?.vapid;
  if (!supabase || !announcementId || !vapid) {
    throw new Error('deliverAnnouncement: supabase, announcementId, and vapid are all required');
  }

  const claimed = await claimAnnouncement(supabase, announcementId);
  if (!claimed) {
    return { announcementId, claimed: false, targetCount: 0, sent: 0, gone: 0, failed: 0 };
  }

  const targets = await fetchPushTargets(supabase, announcementId);
  const ttlSeconds = secondsUntil(claimed.expiresAt, ANNOUNCEMENT_PUSH_TTL_CEILING_SECONDS);

  let sent = 0;
  let gone = 0;
  let failed = 0;

  // Shape matches `announcementPushPayloadSchema` (@avash/types) — sw.js's
  // readPayload() is the other half of that contract and cannot import
  // this file, so any field added here must be mirrored there too.
  const payloadFor = (): unknown => ({
    kind: 'announcement' as const,
    title: claimed.title,
    body: claimed.body,
    announcementId,
  });

  // Chunked by ANNOUNCEMENT_PUSH_BATCH_SIZE (each chunk is small enough
  // to be one Inngest step — see apps/notify/src/inngest/deliverAnnouncement.ts),
  // each chunk sent with at most ANNOUNCEMENT_PUSH_CONCURRENCY in flight.
  const batches = chunk(targets, ANNOUNCEMENT_PUSH_BATCH_SIZE);
  for (const batch of batches) {
    const outcomes = await mapWithConcurrency(batch, ANNOUNCEMENT_PUSH_CONCURRENCY, (target) =>
      sendToOneTarget(supabase, target, payloadFor(), ttlSeconds, vapid),
    );
    for (const outcome of outcomes) {
      if (outcome.outcome === 'sent') sent += 1;
      else if (outcome.outcome === 'gone') gone += 1;
      else failed += 1;
    }
  }

  // Stamped even with zero targets — "delivered to nobody in range" is a
  // completed delivery; leaving pushed_at null would make the sweep
  // rescan this announcement forever.
  const { error: stampError } = await supabase
    .from('announcements')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', announcementId);
  if (stampError) {
    throw new Error(
      `deliverAnnouncement: failed to stamp pushed_at for ${announcementId}: ${stampError.message ?? 'unknown error'}`,
    );
  }

  return {
    announcementId,
    claimed: true,
    targetCount: targets.length,
    sent,
    gone,
    failed,
  };
}
