import { Hono } from 'hono';
import { buildGenericErrorBody } from '@avash/logger';
import { ANNOUNCEMENT_CREATE_RATE_LIMIT, type RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv, Bindings } from '../types';

export interface CreateAnnouncementsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Author-broadcast announcements (decision A — a distinct table and route
 * from `alert_subscriptions`). Route bodies land in Phase 1 (A-T03, A-T04,
 * A-T05); this stub freezes the final middleware chain and mount shape.
 * `GET /` is authenticated, not public (decision H).
 */
export function createAnnouncements(options?: CreateAnnouncementsOptions) {
  return new Hono<AppEnv>()
    .post(
      '/',
      auth({ capability: 'reports:moderate' }),
      rateLimit({
        guard: 'announcement-create',
        window: 'minute',
        windowSeconds: 60,
        limit: ANNOUNCEMENT_CREATE_RATE_LIMIT.perMinute,
        keyStrategy: 'user',
        redisFactory: options?.redisFactory,
      }),
      (c) => c.json(buildGenericErrorBody(c.get('requestId')), 501)
    )
    .get(
      '/',
      auth(),
      rateLimit({
        guard: 'announcement-list',
        window: 'minute',
        windowSeconds: 60,
        limit: ANNOUNCEMENT_CREATE_RATE_LIMIT.perMinute,
        keyStrategy: 'user',
        redisFactory: options?.redisFactory,
      }),
      (c) => c.json(buildGenericErrorBody(c.get('requestId')), 501)
    )
    .delete(
      '/:id',
      auth(),
      rateLimit({
        guard: 'announcement-delete',
        window: 'minute',
        windowSeconds: 60,
        limit: ANNOUNCEMENT_CREATE_RATE_LIMIT.perMinute,
        keyStrategy: 'user',
        redisFactory: options?.redisFactory,
      }),
      (c) => c.json(buildGenericErrorBody(c.get('requestId')), 501)
    );
}

export const announcements = createAnnouncements();
