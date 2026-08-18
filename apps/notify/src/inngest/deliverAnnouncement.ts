import type { AnnouncementPushResult } from '@avash/types';

/**
 * Inngest function for the `announcement/published` event, `{ id }`.
 * Configures `idempotency` on the announcement id, `concurrency`, and
 * `throttle` per the ANNOUNCEMENT_PUSH_* constants
 * (docs/constants-registry.md) — the per-user anti-spam control. Each
 * batch is its own `step.run` so a partial failure retries only that
 * batch. Calls `packages/push`'s `deliverAnnouncement` and contains no
 * delivery logic of its own. Implemented in A-T03.
 */
export interface DeliverAnnouncementEvent {
  id: string;
}

export async function handleAnnouncementPublished(
  _event: DeliverAnnouncementEvent,
): Promise<AnnouncementPushResult> {
  throw new Error('not implemented');
}
