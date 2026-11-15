import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import type { RateLimitRedisLike } from '@avash/security';
import { rateLimit } from '../../src/middleware/rate-limit';
import { requestId } from '../../src/middleware/request-id';
import { auth } from '../../src/middleware/auth';
import type { AppEnv } from '../../src/types';
import { signTestJwt } from '../helpers/fakeJwt';

function fakeRedis(): RateLimitRedisLike & { size(key: string): number } {
  const sets = new Map<string, Map<string, number>>();
  return {
    async zadd(key, entry) {
      const set = sets.get(key) ?? new Map<string, number>();
      set.set(entry.member, entry.score);
      sets.set(key, set);
      return 1;
    },
    async zremrangebyscore() {
      return 0;
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

const env = {
  SUPABASE_JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
} as never;

describe('rate-limit middleware — ip strategy', () => {
  test('allows within the limit and denies past it, with Retry-After on denial', async () => {
    const redis = fakeRedis();
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.get(
      '/guarded',
      rateLimit({ guard: 'test-guard', window: 'minute', windowSeconds: 60, limit: 2, keyStrategy: 'ip', redisFactory: () => redis }),
      (c) => c.json({ ok: true })
    );

    const headers = { 'CF-Connecting-IP': '203.0.113.5' };
    const first = await app.request('/guarded', { headers }, env);
    const second = await app.request('/guarded', { headers }, env);
    const third = await app.request('/guarded', { headers }, env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBe('60');
  });

  test('Redis unreachable falls back gracefully to in-memory sliding window', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.get(
      '/guarded',
      rateLimit({
        guard: 'test-fallback-guard',
        window: 'minute',
        windowSeconds: 60,
        limit: 2,
        keyStrategy: 'ip',
        redisFactory: () => unreachableRedis(),
      }),
      (c) => c.json({ ok: true })
    );

    const headers = { 'CF-Connecting-IP': '203.0.113.9' };
    const first = await app.request('/guarded', { headers }, env);
    const second = await app.request('/guarded', { headers }, env);
    const third = await app.request('/guarded', { headers }, env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBe('60');
  });
});

describe('rate-limit middleware — user strategy', () => {
  test('keys by authenticated user id', async () => {
    const redis = fakeRedis();
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.get(
      '/guarded',
      auth(),
      rateLimit({ guard: 'verify', window: 'minute', windowSeconds: 60, limit: 1, keyStrategy: 'user', redisFactory: () => redis }),
      (c) => c.json({ ok: true })
    );

    const token = await signTestJwt({ role: 'moderator' });
    const first = await app.request('/guarded', { headers: { Authorization: `Bearer ${token}` } }, env);
    const second = await app.request('/guarded', { headers: { Authorization: `Bearer ${token}` } }, env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  test('fails closed (429) if reached with no authenticated user, rather than limiting an empty key', async () => {
    const redis = fakeRedis();
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    // No `auth()` in front — every real route always puts one there, but
    // this proves the middleware itself never limits against a shared
    // undefined-actor key if that guarantee is ever broken.
    app.get(
      '/guarded',
      rateLimit({ guard: 'verify', window: 'minute', windowSeconds: 60, limit: 1, keyStrategy: 'user', redisFactory: () => redis }),
      (c) => c.json({ ok: true })
    );

    const res = await app.request('/guarded', {}, env);
    expect(res.status).toBe(429);
    expect(redis.size('ratelimit:verify:minute:undefined')).toBe(0);
  });
});
