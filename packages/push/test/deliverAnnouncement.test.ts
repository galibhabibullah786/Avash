import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { deliverAnnouncement } from '../deliverAnnouncement';

describe('deliverAnnouncement', () => {
  it('is not yet implemented (A-T02)', async () => {
    await expect(
      deliverAnnouncement({
        supabase: {} as unknown as SupabaseClient,
        announcementId: '11111111-1111-1111-1111-111111111111',
        vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.com' },
      }),
    ).rejects.toThrow('not implemented');
  });
});
