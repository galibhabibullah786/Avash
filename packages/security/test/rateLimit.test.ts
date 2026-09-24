import { describe, test, expect } from 'vitest';
import { checkRateLimit, rateLimitKey, UPLOAD_SIGNATURE_RATE_LIMIT, type RateLimitRedisLike } from '../rateLimit';

describe('UPLOAD_SIGNATURE_RATE_LIMIT', () => {
  test('bounds signature minting to 10/min per user (§14)', () => {
    expect(UPLOAD_SIGNATURE_RATE_LIMIT).toEqual({ perMinute: 10 });
  });
});

/** In-memory sorted set, enough of Upstash's surface for the sliding window. */
function createFakeRedis(): RateLimitRedisLike & { size(key: string): number } {
  const sets = new Map<string, Map<string, number>>();

  return {
    async zadd(key, entry) {
      const set = sets.get(key) ?? new Map<string, number>();
      set.set(entry.member, entry.score);
      sets.set(key, set);
      return 1;
    },
    async zremrangebyscore(key, min, max) {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const [member, score] of set) {
        if (score >= min && score <= max) {
          set.delete(member);
          removed += 1;
        }
      }
      return removed;
    },
    async zcard(key) {
      return sets.get(key)?.size ?? 0;
    },
    async expire() {
      return 1;
    },
    size(key: string) {
      return sets.get(key)?.size ?? 0;
    },
  };
}

function unreachableRedis(): RateLimitRedisLike {
  return {
    zadd: () => Promise.reject(new Error('ECONNREFUSED')),
    zremrangebyscore: () => Promise.reject(new Error('ECONNREFUSED')),
    zcard: () => Promise.reject(new Error('ECONNREFUSED')),
    expire: () => Promise.reject(new Error('ECONNREFUSED')),
  };
}

describe('rateLimitKey', () => {
  test('namespaces a per-minute and per-day counter for the same actor differently', () => {
    const minuteKey = rateLimitKey('symptom-check', 'minute', '1.2.3.4');
    const dayKey = rateLimitKey('symptom-check', 'day', '1.2.3.4');
    expect(minuteKey).not.toBe(dayKey);
  });
});

describe('checkRateLimit — boundary', () => {
  test('allows exactly the Nth request and denies the N+1th', async () => {
    const redis = createFakeRedis();
    const key = rateLimitKey('test-guard', 'minute', 'actor-1');
    const options = { key, limit: 3, windowSeconds: 60 };

    const first = await checkRateLimit(redis, options);
    const second = await checkRateLimit(redis, options);
    const third = await checkRateLimit(redis, options);
    const fourth = await checkRateLimit(redis, options);

    expect(first.ok && first.allowed).toBe(true);
    expect(second.ok && second.allowed).toBe(true);
    expect(third.ok && third.allowed).toBe(true);
    expect(fourth.ok && fourth.allowed).toBe(false);
  });

  test('remaining reaches zero at the limit', async () => {
    const redis = createFakeRedis();
    const key = rateLimitKey('test-guard', 'minute', 'actor-2');
    const options = { key, limit: 1, windowSeconds: 60 };

    const result = await checkRateLimit(redis, options);
    expect(result.ok && result.remaining).toBe(0);
  });
});

describe('checkRateLimit — Redis unreachable', () => {
  test('returns ok:false with a distinguishable reason, never throws', async () => {
    const redis = unreachableRedis();
    const result = await checkRateLimit(redis, { key: 'k', limit: 5, windowSeconds: 60 });
    expect(result).toEqual({ ok: false, reason: 'redis_unreachable' });
  });
});
