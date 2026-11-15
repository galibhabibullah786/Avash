import type { MiddlewareHandler } from 'hono';
import { Redis } from '@upstash/redis';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { checkRateLimit, type RateLimitWindow, type RateLimitRedisLike } from '@avash/security';
import type { AppEnv, Bindings } from '../types';

export type RateLimitKeyStrategy = 'ip' | 'user';

export interface RateLimitOptions {
  /** Names the guard in the Redis key, e.g. "symptom-check", "breeding-report". */
  guard: string;
  window: RateLimitWindow;
  windowSeconds: number;
  limit: number;
  keyStrategy: RateLimitKeyStrategy;
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

const defaultRedisFactory = (env: Bindings): RateLimitRedisLike =>
  new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

// In-memory sliding window fallback for zero-remote resilience during Redis outages or local dev
const inMemoryBuckets = new Map<string, number[]>();

export function checkInMemoryRateLimit(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const timestamps = (inMemoryBuckets.get(key) ?? []).filter((t) => t > windowStart);
  if (timestamps.length >= limit) {
    inMemoryBuckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  inMemoryBuckets.set(key, timestamps);
  return true;
}

export function resetInMemoryRateLimits(): void {
  inMemoryBuckets.clear();
}

function getClientIp(headers: { get(name: string): string | null }): string {
  const cfIp = headers.get('cf-connecting-ip') ?? headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp.trim();
  const realIp = headers.get('x-real-ip') ?? headers.get('X-Real-IP');
  if (realIp) return realIp.trim();
  const forwardedFor = headers.get('x-forwarded-for') ?? headers.get('X-Forwarded-For');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() ?? 'unknown';
  const clientIp = headers.get('client-ip') ?? headers.get('true-client-ip');
  if (clientIp) return clientIp.trim();
  const ua = headers.get('user-agent') ?? '';
  const lang = headers.get('accept-language') ?? '';
  if (ua || lang) {
    return `client-${ua.slice(0, 16)}-${lang.slice(0, 8)}`;
  }
  return 'unknown';
}

/**
 * Rate limit middleware with graceful degradation to in-memory sliding window
 * on Redis unavailability or local offline development.
 */
export const rateLimit =
  (options: RateLimitOptions): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const requestId = c.get('requestId');
    const actor = options.keyStrategy === 'user' ? c.get('user')?.id : getClientIp(c.req.raw.headers);

    if (!actor) {
      logger.error('rate-limit: no actor identifier available', { requestId, guard: options.guard });
      return c.json(buildGenericErrorBody(requestId), 429);
    }

    const key = `ratelimit:${options.guard}:${options.window}:${actor}`;

    // Skip remote Redis if Redis is not configured (local dev mode and no test factory injected)
    if (!options.redisFactory && (!c.env.UPSTASH_REDIS_REST_URL || !c.env.UPSTASH_REDIS_REST_TOKEN)) {
      const allowed = checkInMemoryRateLimit(key, options.limit, options.windowSeconds);
      if (!allowed) {
        c.header('Retry-After', String(options.windowSeconds));
        return c.json(buildGenericErrorBody(requestId), 429);
      }
      return next();
    }

    const redis = (options.redisFactory ?? defaultRedisFactory)(c.env);
    
    try {
      const result = await checkRateLimit(redis, { key, limit: options.limit, windowSeconds: options.windowSeconds });

      if (!result.ok) {
        logger.warn('rate-limit: Redis unreachable, falling back to in-memory sliding window', {
          requestId,
          guard: options.guard,
        });
        const allowed = checkInMemoryRateLimit(key, options.limit, options.windowSeconds);
        if (!allowed) {
          c.header('Retry-After', String(options.windowSeconds));
          return c.json(buildGenericErrorBody(requestId), 429);
        }
        return next();
      }

      if (!result.allowed) {
        c.header('Retry-After', String(options.windowSeconds));
        return c.json(buildGenericErrorBody(requestId), 429);
      }
    } catch (error) {
      logger.warn('rate-limit: Redis error, falling back to in-memory sliding window', {
        requestId,
        guard: options.guard,
        error: error instanceof Error ? error.message : String(error),
      });
      const allowed = checkInMemoryRateLimit(key, options.limit, options.windowSeconds);
      if (!allowed) {
        c.header('Retry-After', String(options.windowSeconds));
        return c.json(buildGenericErrorBody(requestId), 429);
      }
      return next();
    }

    await next();
  };
