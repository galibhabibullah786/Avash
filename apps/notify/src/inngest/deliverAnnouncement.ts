import { createClient } from '@supabase/supabase-js';
import { deliverAnnouncement } from '@avash/push';
import { ANNOUNCEMENT_PUSH_CONCURRENCY, type AnnouncementPushResult } from '@avash/types';
import { inngest } from './client';

/**
 * Inngest function for the `announcement/published` event, `{ id }`.
 * Calls straight into `packages/push`'s `deliverAnnouncement` and
 * contains no delivery logic of its own — see
 * `docs/features/announcement-push.md` for the full claim/send/stamp
 * sequence that lives there.
 */
export interface DeliverAnnouncementEvent {
  id: string;
}

function readEnv(name: string): string {
  // Server-only code (apps/notify is never bundled to a browser); the
  // shared `no-restricted-syntax` rule in packages/config/eslint-config's
  // `noNonPublicEnvUnderWeb` is meant for apps/web only but its `files`
  // glob (`src/**/*.{ts,tsx}`) is missing an `apps/web/` prefix, so it
  // matches every app's src/ tree, not just apps/web's. Flagged for a
  // shared-config fix rather than worked around by disabling the rule
  // outright.
  // eslint-disable-next-line no-restricted-syntax
  const value = process.env?.[name];
  if (!value) {
    throw new Error(`apps/notify: missing required env var ${name}`);
  }
  return value;
}

interface DeliveryConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
}

/**
 * Reads everything delivery needs from `process.env` in one place. Kept
 * as its own `step.run` in the Inngest function below so a retried run
 * doesn't need to re-derive it (cheap either way, but it keeps the
 * env-var names in one spot instead of scattered across the function
 * body) — see the resolve-delivery-config comment inline below for why
 * that matters for the retry-granularity test.
 */
function resolveDeliveryConfig(): DeliveryConfig {
  return {
    supabaseUrl: readEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY'),
    vapidPublicKey: readEnv('VAPID_PUBLIC_KEY'),
    vapidPrivateKey: readEnv('VAPID_PRIVATE_KEY'),
    // No dedicated env var for this in .env.example (ADR-016's secrets
    // inventory only lists the keypair) — mailto: contact per RFC 8292,
    // overridable without a migration if the project ever wants a real
    // one.
    // eslint-disable-next-line no-restricted-syntax -- see readEnv()'s comment above
    vapidSubject: process.env?.VAPID_SUBJECT || 'mailto:support@avash.app',
  };
}

/**
 * Core delivery logic, kept as a plain async function (not
 * Inngest-step-aware) matching the frozen stub signature so it stays
 * callable outside of Inngest's step machinery too. Resolves its own
 * config and Supabase client, then hands off to `packages/push` — this
 * function does no delivery work itself.
 */
export async function handleAnnouncementPublished(
  event: DeliverAnnouncementEvent,
): Promise<AnnouncementPushResult> {
  const announcementId = event?.id;
  if (!announcementId) {
    throw new Error('handleAnnouncementPublished: event.id is required');
  }
  const config = resolveDeliveryConfig();
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  return deliverAnnouncement({
    supabase,
    announcementId,
    vapid: {
      publicKey: config.vapidPublicKey,
      privateKey: config.vapidPrivateKey,
      subject: config.vapidSubject,
    },
  });
}

export const deliverAnnouncementFn = inngest.createFunction(
  {
    id: 'announcement-push-delivery',
    // Stops the SAME announcement id from spawning two concurrent runs
    // within Inngest's idempotency window — e.g. the Supabase Database
    // Webhook and the sweep both firing for the same row close together
    // (ADR-016's whole reason for the DB-side claim/lease still applies
    // as the authoritative guard; this is a cheaper first line of
    // defense that avoids even starting the second run).
    idempotency: 'event.data.id',
    // ANNOUNCEMENT_PUSH_CONCURRENCY (10) bounds simultaneous FUNCTION
    // RUNS. This is deliberately the same number `packages/push`'s own
    // mapWithConcurrency already uses to bound in-flight HTTP sends
    // *within* one run — reusing it here keeps the whole app's total
    // concurrent send volume in the same order of magnitude that a
    // single run was already designed for, instead of letting N
    // concurrently-published announcements each open 10 more.
    //
    // ANNOUNCEMENT_PUSH_MAX_PER_USER_PER_HOUR (6) is deliberately NOT
    // wired into `throttle` here. Inngest's `throttle`/`concurrency` keys
    // are evaluated once per RUN from the triggering event — one run
    // already fans out to every subscriber the RPC matches, so there is
    // no per-recipient key available inside a single run's throttle
    // expression to hang a 6-per-user cap on. A `throttle` keyed on
    // something announcement-scoped would just be a second,
    // differently-labelled copy of the concurrency limit above, and
    // shipping it would misrepresent what's actually being enforced.
    // A real per-subscriber-per-hour ceiling needs a send-count check
    // keyed by user_id inside the delivery pass itself (e.g. a
    // `push_deliveries` log table), which this slice's migrations don't
    // include — recorded here as a known gap rather than faked.
    concurrency: { limit: ANNOUNCEMENT_PUSH_CONCURRENCY },
    triggers: { event: 'announcement/published' },
  },
  async ({ event, step }) => {
    // Two steps so a retry doesn't need to re-run config resolution once
    // it has already succeeded (cheap here, but the pattern matters more
    // than the cost: it demonstrates the actual retry unit is
    // per-`step.run`, not per-function). The delivery step wraps the
    // ENTIRE `deliverAnnouncement` call rather than one `step.run` per
    // internal batch — packages/push stays step-unaware by design (no
    // Inngest/Vercel/node:* imports there), so a partial failure inside
    // delivery retries the WHOLE announcement, not just the batch that
    // failed. That's coarser than per-batch retry would be, but safe:
    // the claim/lease in packages/push's deliverAnnouncement makes a
    // retried run either cleanly re-claim (if the prior attempt crashed
    // mid-send) or observe `claimed: false` and no-op (if it didn't).
    const config = await step.run('resolve-delivery-config', async () => resolveDeliveryConfig());

    const result = await step.run('deliver-announcement', async () => {
      const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
      return deliverAnnouncement({
        supabase,
        announcementId: event?.data?.id,
        vapid: {
          publicKey: config.vapidPublicKey,
          privateKey: config.vapidPrivateKey,
          subject: config.vapidSubject,
        },
      });
    });

    return result;
  },
);
