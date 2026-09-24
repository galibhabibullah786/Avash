import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendWebPushResult } from '../webPush';

vi.mock('../webPush', () => ({
  sendWebPush: vi.fn(),
}));

// Imported after the mock so `deliverAnnouncement` picks up the mocked module.
import { sendWebPush } from '../webPush';
import { deliverAnnouncement } from '../deliverAnnouncement';

const ANNOUNCEMENT_ID = '11111111-1111-1111-1111-111111111111';
const VAPID = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:test@example.com' };

const sendWebPushMock = vi.mocked(sendWebPush);

interface ClaimRow {
  id: string;
  title: string;
  body: string;
  expires_at: string | null;
}

interface TargetRow {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

/**
 * A minimal fake of the supabase-js fluent query builder. Every chain
 * method returns `this`; the object is itself thenable so `await
 * supabase.from(...).update(...).eq(...)....` resolves to whatever the
 * harness decides for that call, however many links are in the chain.
 */
class FakeAnnouncementsBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private mode: 'claim' | 'stamp' | null = null;

  constructor(private readonly harness: Harness) {}

  update(payload: Record<string, unknown>): this {
    this.mode = 'push_claimed_at' in payload ? 'claim' : 'stamp';
    return this;
  }

  eq(): this {
    return this;
  }

  is(): this {
    return this;
  }

  or(): this {
    return this;
  }

  select(): this {
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result =
      this.mode === 'claim' ? this.harness.nextClaimResult() : this.harness.stamp();
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

class FakePushSubscriptionsBuilder {
  constructor(private readonly harness: Harness) {}

  delete(): { eq: (col: string, id: string) => Promise<{ error: null }> } {
    return {
      eq: (_col: string, id: string) => {
        this.harness.deletedSubscriptionIds.push(id);
        return Promise.resolve({ error: null });
      },
    };
  }
}

class Harness {
  claimQueue: Array<{ data: ClaimRow[] | null; error: { message: string } | null }>;
  targetsResult: { data: TargetRow[] | null; error: { message: string } | null };
  deletedSubscriptionIds: string[] = [];
  stampCallCount = 0;

  constructor(opts: {
    claimQueue: Array<{ data: ClaimRow[] | null; error: { message: string } | null }>;
    targetsResult: { data: TargetRow[] | null; error: { message: string } | null };
  }) {
    this.claimQueue = opts.claimQueue;
    this.targetsResult = opts.targetsResult;
  }

  nextClaimResult(): { data: ClaimRow[] | null; error: { message: string } | null } {
    return this.claimQueue.shift() ?? { data: [], error: null };
  }

  stamp(): { data: null; error: null } {
    this.stampCallCount += 1;
    return { data: null, error: null };
  }

  supabase(): SupabaseClient {
    const harness = this;
    return {
      from(table: string) {
        if (table === 'announcements') return new FakeAnnouncementsBuilder(harness);
        if (table === 'push_subscriptions') return new FakePushSubscriptionsBuilder(harness);
        throw new Error(`unexpected table: ${table}`);
      },
      rpc(name: string) {
        if (name !== 'announcement_push_targets') throw new Error(`unexpected rpc: ${name}`);
        return Promise.resolve(harness.targetsResult);
      },
    } as unknown as SupabaseClient;
  }
}

function claimRow(overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    id: ANNOUNCEMENT_ID,
    title: 'Boil water advisory',
    body: 'Please boil tap water before drinking until further notice.',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

function targetRow(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    subscription_id: 'sub-1',
    endpoint: 'https://push.example.test/1',
    p256dh: 'p256dh',
    auth_key: 'auth',
    ...overrides,
  };
}

describe('deliverAnnouncement', () => {
  beforeEach(() => {
    sendWebPushMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('concurrent claim: exactly one caller delivers, the other observes claimed=false', async () => {
    const harness = new Harness({
      claimQueue: [
        { data: [claimRow()], error: null }, // first caller wins the race
        { data: [], error: null }, // second caller's UPDATE matches no row
      ],
      targetsResult: { data: [], error: null },
    });
    const supabase = harness.supabase();

    const [first, second] = await Promise.all([
      deliverAnnouncement({ supabase, announcementId: ANNOUNCEMENT_ID, vapid: VAPID }),
      deliverAnnouncement({ supabase, announcementId: ANNOUNCEMENT_ID, vapid: VAPID }),
    ]);

    const claimedResults = [first, second].filter((r) => r.claimed);
    const unclaimedResults = [first, second].filter((r) => !r.claimed);
    expect(claimedResults).toHaveLength(1);
    expect(unclaimedResults).toHaveLength(1);
    expect(unclaimedResults[0]).toEqual({
      announcementId: ANNOUNCEMENT_ID,
      claimed: false,
      targetCount: 0,
      sent: 0,
      gone: 0,
      failed: 0,
    });
  });

  it('zero targets still stamps pushed_at (a delivery to nobody in range is a completed delivery)', async () => {
    const harness = new Harness({
      claimQueue: [{ data: [claimRow()], error: null }],
      targetsResult: { data: [], error: null },
    });

    const result = await deliverAnnouncement({
      supabase: harness.supabase(),
      announcementId: ANNOUNCEMENT_ID,
      vapid: VAPID,
    });

    expect(result).toEqual({
      announcementId: ANNOUNCEMENT_ID,
      claimed: true,
      targetCount: 0,
      sent: 0,
      gone: 0,
      failed: 0,
    });
    expect(harness.stampCallCount).toBe(1);
    expect(sendWebPushMock).not.toHaveBeenCalled();
  });

  it('a 410 deletes exactly that subscription row and counts it as gone', async () => {
    const harness = new Harness({
      claimQueue: [{ data: [claimRow()], error: null }],
      targetsResult: { data: [targetRow({ subscription_id: 'sub-gone' })], error: null },
    });
    sendWebPushMock.mockResolvedValue({ outcome: 'gone', statusCode: 410 } satisfies SendWebPushResult);

    const result = await deliverAnnouncement({
      supabase: harness.supabase(),
      announcementId: ANNOUNCEMENT_ID,
      vapid: VAPID,
    });

    expect(result).toMatchObject({ claimed: true, targetCount: 1, sent: 0, gone: 1, failed: 0 });
    expect(harness.deletedSubscriptionIds).toEqual(['sub-gone']);
    expect(harness.stampCallCount).toBe(1);
  });

  it('a non-410 failure leaves the subscription row and continues to the next target', async () => {
    const harness = new Harness({
      claimQueue: [{ data: [claimRow()], error: null }],
      targetsResult: {
        data: [
          targetRow({ subscription_id: 'sub-fail' }),
          targetRow({ subscription_id: 'sub-ok', endpoint: 'https://push.example.test/2' }),
        ],
        error: null,
      },
    });
    sendWebPushMock.mockImplementation(async (opts) => {
      if (opts.subscription.endpoint === 'https://push.example.test/1') {
        return { outcome: 'failed', statusCode: 500 } satisfies SendWebPushResult;
      }
      return { outcome: 'sent', statusCode: 201 } satisfies SendWebPushResult;
    });

    const result = await deliverAnnouncement({
      supabase: harness.supabase(),
      announcementId: ANNOUNCEMENT_ID,
      vapid: VAPID,
    });

    expect(result).toMatchObject({ claimed: true, targetCount: 2, sent: 1, gone: 0, failed: 1 });
    expect(harness.deletedSubscriptionIds).toEqual([]);
    expect(harness.stampCallCount).toBe(1);
  });

  it('an expired announcement (RPC returns zero rows) still completes as a stamped, zero-target delivery', async () => {
    const harness = new Harness({
      claimQueue: [{ data: [claimRow()], error: null }],
      // The RPC's own SQL filters `expires_at > now()` — an expired
      // announcement resolves to zero targets even though the claim
      // itself only checks pushed_at/push_claimed_at.
      targetsResult: { data: [], error: null },
    });

    const result = await deliverAnnouncement({
      supabase: harness.supabase(),
      announcementId: ANNOUNCEMENT_ID,
      vapid: VAPID,
    });

    expect(result).toEqual({
      announcementId: ANNOUNCEMENT_ID,
      claimed: true,
      targetCount: 0,
      sent: 0,
      gone: 0,
      failed: 0,
    });
    expect(harness.stampCallCount).toBe(1);
  });

  it('TTL passed to sendWebPush is never 0, even when the announcement is already past expiry', async () => {
    const harness = new Harness({
      claimQueue: [{ data: [claimRow({ expires_at: new Date(Date.now() - 60_000).toISOString() })], error: null }],
      targetsResult: { data: [targetRow()], error: null },
    });
    sendWebPushMock.mockResolvedValue({ outcome: 'sent', statusCode: 201 } satisfies SendWebPushResult);

    await deliverAnnouncement({ supabase: harness.supabase(), announcementId: ANNOUNCEMENT_ID, vapid: VAPID });

    expect(sendWebPushMock).toHaveBeenCalledTimes(1);
    const callOptions = sendWebPushMock.mock.calls[0]?.[0];
    expect(callOptions?.ttlSeconds).toBeGreaterThanOrEqual(1);
  });

  it('TTL passed to sendWebPush is clamped to the announcement remaining lifetime and never 0 for a null expiry', async () => {
    const harness = new Harness({
      claimQueue: [{ data: [claimRow({ expires_at: null })], error: null }],
      targetsResult: { data: [targetRow()], error: null },
    });
    sendWebPushMock.mockResolvedValue({ outcome: 'sent', statusCode: 201 } satisfies SendWebPushResult);

    await deliverAnnouncement({ supabase: harness.supabase(), announcementId: ANNOUNCEMENT_ID, vapid: VAPID });

    const callOptions = sendWebPushMock.mock.calls[0]?.[0];
    expect(callOptions?.ttlSeconds).toBeGreaterThanOrEqual(1);
  });

  it('passes the announcement id, title, and body through to the push payload (readPayload() contract)', async () => {
    const harness = new Harness({
      claimQueue: [{ data: [claimRow({ title: 'Flood warning', body: 'Move to higher ground.' })], error: null }],
      targetsResult: { data: [targetRow()], error: null },
    });
    sendWebPushMock.mockResolvedValue({ outcome: 'sent', statusCode: 201 } satisfies SendWebPushResult);

    await deliverAnnouncement({ supabase: harness.supabase(), announcementId: ANNOUNCEMENT_ID, vapid: VAPID });

    const callOptions = sendWebPushMock.mock.calls[0]?.[0];
    expect(callOptions?.payload).toEqual({
      kind: 'announcement',
      title: 'Flood warning',
      body: 'Move to higher ground.',
      announcementId: ANNOUNCEMENT_ID,
    });
  });
});
