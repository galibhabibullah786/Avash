import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnnouncementPushResult } from '@avash/types';
import type { WebPushVapidConfig } from './webPush';

/**
 * The whole delivery pass for one announcement, host-agnostic: claim with
 * a lease, call `announcement_push_targets`, fan out, handle `410`s, stamp
 * `pushed_at`. Implemented in A-T02 — see
 * `docs/features/announcement-push.md` for the exact sequence.
 */
export interface DeliverAnnouncementOptions {
  supabase: SupabaseClient;
  announcementId: string;
  vapid: WebPushVapidConfig;
}

export async function deliverAnnouncement(
  _options: DeliverAnnouncementOptions,
): Promise<AnnouncementPushResult> {
  throw new Error('not implemented');
}
