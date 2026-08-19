import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ANNOUNCEMENT_PUSH_LEASE_SECONDS, ANNOUNCEMENT_PUSH_SWEEP_CADENCE } from '@avash/types';
import { inngest } from './client';

/**
 * Cron at `ANNOUNCEMENT_PUSH_SWEEP_CADENCE`. Selects live announcements
 * where `pushed_at is null` and the claim is absent or older than
 * `ANNOUNCEMENT_PUSH_LEASE_SECONDS`, then fans out one
 * `announcement/published` event each — re-using `deliverAnnouncementFn`
 * rather than duplicating delivery. Safety net for the primary Supabase
 * Database Webhook trigger (ADR-016 decision C).
 */
export interface SweepResult {
  sweptAnnouncementIds: string[];
}

function readEnv(name: string): string {
  // Server-only code (apps/notify is never bundled to a browser); see
  // the identical comment in ./deliverAnnouncement.ts's readEnv() for
  // why this rule misfires here (a shared-config glob bug, not a real R2
  // violation).
  // eslint-disable-next-line no-restricted-syntax
  const value = process.env?.[name];
  if (!value) {
    throw new Error(`apps/notify: missing required env var ${name}`);
  }
  return value;
}

interface UndeliveredAnnouncementRow {
  id: string;
}

async function findUndeliveredAnnouncementIds(supabase: SupabaseClient): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const leaseCutoffIso = new Date(Date.now() - ANNOUNCEMENT_PUSH_LEASE_SECONDS * 1000).toISOString();

  const { data, error } = await supabase
    .from('announcements')
    .select('id')
    .is('pushed_at', null)
    .gt('expires_at', nowIso)
    .or(`push_claimed_at.is.null,push_claimed_at.lt.${leaseCutoffIso}`);

  if (error) {
    throw new Error(`sweepUndeliveredAnnouncements: query failed: ${error.message ?? 'unknown error'}`);
  }

  const rows = (data ?? []) as UndeliveredAnnouncementRow[];
  return rows.map((row) => row?.id).filter((id): id is string => !!id);
}

export async function sweepUndeliveredAnnouncements(): Promise<SweepResult> {
  const supabase = createClient(readEnv('SUPABASE_URL'), readEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const ids = await findUndeliveredAnnouncementIds(supabase);

  for (const id of ids) {
    await inngest.send({ name: 'announcement/published', data: { id } });
  }

  return { sweptAnnouncementIds: ids };
}

export const sweepUndeliveredFn = inngest.createFunction(
  { id: 'announcement-push-sweep', triggers: { cron: ANNOUNCEMENT_PUSH_SWEEP_CADENCE } },
  async ({ step }) => step.run('sweep-undelivered-announcements', async () => sweepUndeliveredAnnouncements()),
);
