/**
 * Cron at `ANNOUNCEMENT_PUSH_SWEEP_CADENCE` (docs/constants-registry.md).
 * Selects live announcements where `pushed_at is null` and the claim is
 * absent or older than `ANNOUNCEMENT_PUSH_LEASE_SECONDS`, then fans out
 * one `announcement/published` event each — re-using
 * `handleAnnouncementPublished` rather than duplicating delivery.
 * Safety net for the primary Supabase Database Webhook trigger (ADR-016
 * decision C). Implemented in A-T05.
 */
export interface SweepResult {
  sweptAnnouncementIds: string[];
}

export async function sweepUndeliveredAnnouncements(): Promise<SweepResult> {
  throw new Error('not implemented');
}
