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

function getClientIp(headers: { get(name: string): string | null }): string {
  const cfIp = headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const forwardedFor = headers.get('X-Forwarded-For');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() ?? 'unknown';
  return 'unknown';
}

/**
 * Every route this middleware guards is a write or LLM route (public GETs
 * skip rate-limiting entirely per decision J), so a Redis outage always
 * fails closed here — a limiter you cannot consult is not a limiter.
 */
export const rateLimit =
  (options: RateLimitOptions): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const requestId = c.get('requestId');
    const actor = options.keyStrategy === 'user' ? c.get('user')?.id : getClientIp(c.req.raw.headers);

    if (!actor) {
      // keyStrategy: 'user' with no authenticated user means auth ran
      // first and already 401ed — this middleware should never be
      // reached without an actor, but fail closed rather than limit
      // against an empty/shared key if it somehow is.
      logger.error('rate-limit: no actor identifier available', { requestId, guard: options.guard });
      return c.json(buildGenericErrorBody(requestId), 429);
    }

    // Skip rate limiting if Redis is not configured (local dev mode)
    if (!c.env.UPSTASH_REDIS_REST_URL || !c.env.UPSTASH_REDIS_REST_TOKEN) {
      logger.warn('rate-limit: Redis not configured, skipping (local dev mode)', { requestId, guard: options.guard });
      return next();
    }

    const redis = (options.redisFactory ?? defaultRedisFactory)(c.env);
    const key = `ratelimit:${options.guard}:${options.window}:${actor}`;
    
    try {
      const result = await checkRateLimit(redis, { key, limit: options.limit, windowSeconds: options.windowSeconds });

      if (!result.ok) {
        logger.error('rate-limit: Redis unreachable, failing closed', { requestId, guard: options.guard });
        return c.json(buildGenericErrorBody(requestId), 429);
      }

      if (!result.allowed) {
        c.header('Retry-After', String(options.windowSeconds));
        return c.json(buildGenericErrorBody(requestId), 429);
      }
    } catch (error) {
      logger.error('rate-limit: Redis error, failing closed', { requestId, guard: options.guard, error: error instanceof Error ? error.message : String(error) });
      return c.json(buildGenericErrorBody(requestId), 429);
    }

    await next();
  };
