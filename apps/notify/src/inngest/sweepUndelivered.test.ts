import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCEMENT_PUSH_SWEEP_CADENCE } from '@avash/types';

const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: (...args: unknown[]) => createClientMock(...args) };
});

import { inngest } from './client';
import { sweepUndeliveredAnnouncements, sweepUndeliveredFn } from './sweepUndelivered';

interface AnnouncementRow {
  id: string;
  pushed_at: string | null;
  push_claimed_at: string | null;
  expires_at: string;
}

/**
 * A fake `announcements` table plus a query builder that actually
 * APPLIES the `.is()` / `.gt()` / `.or()` predicates in JS, rather than
 * a dumb stub that returns whatever a test tells it to. This is what
 * makes the "fresh claim is not reclaimed" / "expired claim is
 * reclaimed" assertions meaningful — they exercise the real filter
 * logic the sweep query relies on, not a mocked-out answer.
 */
class FakeAnnouncementsQuery implements PromiseLike<{ data: AnnouncementRow[]; error: null }> {
  private predicates: Array<(row: AnnouncementRow) => boolean> = [];

  constructor(private readonly rows: AnnouncementRow[]) {}

  select(): this {
    return this;
  }

  is(column: keyof AnnouncementRow, value: null): this {
    this.predicates.push((row) => row[column] === value);
    return this;
  }

  gt(column: keyof AnnouncementRow, value: string): this {
    this.predicates.push((row) => {
      const cell = row[column];
      return typeof cell === 'string' && cell > value;
    });
    return this;
  }

  or(expression: string): this {
    // Mirrors PostgREST's `.or('a.is.null,a.lt.<value>')` syntax for
    // exactly the two conditions the sweep query uses.
    const conditions = expression.split(',').map((part) => {
      const [column, op, value] = part.split('.') as [keyof AnnouncementRow, string, string];
      return { column, op, value };
    });
    this.predicates.push((row) =>
      conditions.some(({ column, op, value }) => {
        const cell = row[column];
        if (op === 'is' && value === 'null') return cell === null;
        if (op === 'lt') return typeof cell === 'string' && cell < value;
        throw new Error(`unsupported or() condition: ${op}`);
      }),
    );
    return this;
  }

  then<TResult1 = { data: AnnouncementRow[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: AnnouncementRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const matched = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
    return Promise.resolve({ data: matched, error: null }).then(onfulfilled, onrejected);
  }
}

function createFakeSupabase(rows: AnnouncementRow[]): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'announcements') throw new Error(`unexpected table: ${table}`);
      return new FakeAnnouncementsQuery(rows);
    },
  } as unknown as SupabaseClient;
}

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

/* eslint-disable no-restricted-syntax -- server-only test code (apps/notify
   is never bundled to a browser); packages/config/eslint-config's
   `noNonPublicEnvUnderWeb` rule is meant for apps/web only but its `files`
   glob is missing an `apps/web/` prefix, so it misfires on every app's
   src/ tree. Flagged for a shared-config fix, worked around locally here. */
function withRequiredEnv(): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  return () => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}
/* eslint-enable no-restricted-syntax */

const HOUR_MS = 60 * 60 * 1000;

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}

describe('sweepUndeliveredAnnouncements', () => {
  beforeEach(() => {
    vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    createClientMock.mockReset();
  });

  async function withFakeSupabase(rows: AnnouncementRow[], run: () => Promise<void>): Promise<void> {
    createClientMock.mockReturnValue(createFakeSupabase(rows));
    await run();
  }

  it('does not reclaim/re-emit an announcement whose claim is still fresh (within the lease window)', async () => {
    const restore = withRequiredEnv();
    const rows: AnnouncementRow[] = [
      {
        id: 'fresh-claim',
        pushed_at: null,
        push_claimed_at: isoMinutesAgo(1), // well inside ANNOUNCEMENT_PUSH_LEASE_SECONDS (300s = 5min)
        expires_at: isoHoursFromNow(1),
      },
    ];

    await withFakeSupabase(rows, async () => {
      const result = await sweepUndeliveredAnnouncements();
      expect(result.sweptAnnouncementIds).toEqual([]);
      expect(inngest.send).not.toHaveBeenCalled();
    });
    restore();
  });

  it('reclaims and re-emits an announcement whose claim has expired (past the lease window)', async () => {
    const restore = withRequiredEnv();
    const rows: AnnouncementRow[] = [
      {
        id: 'expired-claim',
        pushed_at: null,
        push_claimed_at: isoMinutesAgo(10), // past the 5-minute lease
        expires_at: isoHoursFromNow(1),
      },
    ];

    await withFakeSupabase(rows, async () => {
      const result = await sweepUndeliveredAnnouncements();
      expect(result.sweptAnnouncementIds).toEqual(['expired-claim']);
      expect(inngest.send).toHaveBeenCalledTimes(1);
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'announcement/published',
        data: { id: 'expired-claim' },
      });
    });
    restore();
  });

  it('never re-emits an announcement that already has pushed_at set', async () => {
    const restore = withRequiredEnv();
    const rows: AnnouncementRow[] = [
      {
        id: 'already-delivered',
        pushed_at: new Date().toISOString(),
        push_claimed_at: isoMinutesAgo(10),
        expires_at: isoHoursFromNow(1),
      },
    ];

    await withFakeSupabase(rows, async () => {
      const result = await sweepUndeliveredAnnouncements();
      expect(result.sweptAnnouncementIds).toEqual([]);
      expect(inngest.send).not.toHaveBeenCalled();
    });
    restore();
  });

  it('never claims/re-emits an unclaimed announcement (push_claimed_at null) — still swept once, not double-counted', async () => {
    const restore = withRequiredEnv();
    const rows: AnnouncementRow[] = [
      {
        id: 'never-claimed',
        pushed_at: null,
        push_claimed_at: null,
        expires_at: isoHoursFromNow(1),
      },
    ];

    await withFakeSupabase(rows, async () => {
      const result = await sweepUndeliveredAnnouncements();
      expect(result.sweptAnnouncementIds).toEqual(['never-claimed']);
      expect(inngest.send).toHaveBeenCalledTimes(1);
    });
    restore();
  });

  it('ignores an announcement that has already expired', async () => {
    const restore = withRequiredEnv();
    const rows: AnnouncementRow[] = [
      {
        id: 'expired-announcement',
        pushed_at: null,
        push_claimed_at: null,
        expires_at: isoMinutesAgo(5),
      },
    ];

    await withFakeSupabase(rows, async () => {
      const result = await sweepUndeliveredAnnouncements();
      expect(result.sweptAnnouncementIds).toEqual([]);
    });
    restore();
  });
});

describe('sweepUndeliveredFn', () => {
  it('has a stable function id', () => {
    expect(sweepUndeliveredFn.id()).toBe('announcement-push-sweep');
  });

  it('is scheduled at ANNOUNCEMENT_PUSH_SWEEP_CADENCE', () => {
    expect(sweepUndeliveredFn.opts.triggers).toEqual([{ cron: ANNOUNCEMENT_PUSH_SWEEP_CADENCE }]);
  });
});
