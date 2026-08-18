import { Hono } from 'hono';
import { buildGenericErrorBody } from '@avash/logger';
import { ALERT_SUBSCRIBE_RATE_LIMIT, type RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv, Bindings } from '../types';

export interface CreateAlertsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * CRUD only (decision C) — the Worker never scores risk or sends a push;
 * `ml/serving/predict.py` owns the `ST_DWithin` match and the `pywebpush`
 * send. Route bodies land in Phase 1 (A-T01, A-T02); this stub freezes the
 * final middleware chain and mount shape.
 */
export function createAlerts(options?: CreateAlertsOptions) {
  return new Hono<AppEnv>()
    .post(
      '/subscribe',
      auth(),
      rateLimit({
        guard: 'alert-subscribe',
        window: 'minute',
        windowSeconds: 60,
        limit: ALERT_SUBSCRIBE_RATE_LIMIT.perMinute,
        keyStrategy: 'user',
        redisFactory: options?.redisFactory,
      }),
      (c) => c.json(buildGenericErrorBody(c.get('requestId')), 501)
    )
    .post(
      '/push-subscription',
      auth(),
      rateLimit({
        guard: 'push-subscribe',
        window: 'minute',
        windowSeconds: 60,
        limit: ALERT_SUBSCRIBE_RATE_LIMIT.perMinute,
        keyStrategy: 'user',
        redisFactory: options?.redisFactory,
      }),
      (c) => c.json(buildGenericErrorBody(c.get('requestId')), 501)
    );
}

export const alerts = createAlerts();
