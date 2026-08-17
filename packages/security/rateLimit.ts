/**
 * Sliding-window rate limiting over Upstash's REST API (Worker- and
 * Node-safe — REST, not a TCP client, per ADR-009/decision D). The window
 * is a sorted set keyed per guard+window+actor: each request adds a
 * timestamped member, prunes members older than the window, then counts
 * what's left. A minute counter and a day counter for the same actor never
 * collide because the window granularity is part of the key.
 */

export interface RateLimitRedisLike {
  zadd(key: string, entry: { score: number; member: string }): Promise<unknown>;
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export type RateLimitResult =
  | { ok: true; allowed: boolean; remaining: number; resetAt: number }
  | { ok: false; reason: 'redis_unreachable' };

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowSeconds: number;
}

/** §14 rate-limit constants, one object per guard so a caller passes exactly the window it means. */
export const BREEDING_REPORT_RATE_LIMIT = { perMinute: 5, perDay: 20 } as const;
export const SYMPTOM_CHECK_RATE_LIMIT = { perMinute: 10, perDay: 50 } as const;
export const BLOOD_UPDATE_RATE_LIMIT = { perMinute: 10 } as const;
export const REPORT_VERIFY_RATE_LIMIT = { perMinute: 20 } as const;
/**
 * Low on purpose. Role administration is a rare, deliberate human action;
 * a burst of them is either a mistake or a compromised admin session, and
 * either way slowing it down is the right response.
 */
export const ROLE_ASSIGNMENT_RATE_LIMIT = { perMinute: 10 } as const;
/**
 * `UPLOAD_SIGNATURE_RATE_LIMIT` (§14) — bounds signature minting per
 * account. A signature costs Cloudinary nothing to issue, but every one
 * minted is a standing invitation to upload against your quota, so the
 * limit sits on the mint, not the upload itself (decision G).
 */
export const UPLOAD_SIGNATURE_RATE_LIMIT = { perMinute: 10 } as const;

export type RateLimitWindow = 'minute' | 'day';

/** Namespaced so `guard:minute:actor` and `guard:day:actor` never collide. */
export function rateLimitKey(guard: string, window: RateLimitWindow, actor: string): string {
  return `ratelimit:${guard}:${window}:${actor}`;
}

export async function checkRateLimit(redis: RateLimitRedisLike, options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = options;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    await redis.zremrangebyscore(key, 0, windowStart);
    await redis.zadd(key, { score: now, member: `${now}:${Math.random().toString(36).slice(2)}` });
    const count = await redis.zcard(key);
    await redis.expire(key, windowSeconds);

    return {
      ok: true,
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: now + windowSeconds * 1000,
    };
  } catch {
    return { ok: false, reason: 'redis_unreachable' };
  }
}
