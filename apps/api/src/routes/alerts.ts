import { Hono } from 'hono';
import { alertSubscribeSchema, pushSubscriptionRegisterSchema } from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { ALERT_SUBSCRIBE_RATE_LIMIT, type RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { recordAudit } from '../lib/auditWrite';
import type { AppEnv, Bindings } from '../types';

export interface CreateAlertsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * CRUD only (decision C) — the Worker never scores risk or sends a push;
 * `ml/serving/predict.py` owns the `ST_DWithin` match and the `pywebpush`
 * send. This route only manages the `alert_subscriptions` and
 * `push_subscriptions` rows that batch job reads.
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
      async (c) => {
        const requestId = c.get('requestId');
        const user = c.get('user');
        if (!user) {
          // auth() always sets this before next() — defensive only, never
          // exercised in practice.
          return c.json(buildGenericErrorBody(requestId), 401);
        }

        const body = await c.req.json().catch(() => undefined);
        const parsed = alertSubscribeSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        try {
          const supabase = createSupabaseAdmin(c.env);
          // Upsert on (user_id, geom): a user may hold more than one
          // geofence (e.g. home and work), each identified by its point.
          // Re-subscribing at the same point updates radius/active in
          // place instead of accumulating duplicate rows.
          const { data, error } = await supabase
            .from('alert_subscriptions')
            .upsert(
              {
                user_id: user.id,
                geom: { type: 'Point', coordinates: [parsed.data.lng, parsed.data.lat] },
                radius_m: parsed.data.radiusM,
                active: parsed.data.active,
              },
              { onConflict: 'user_id,geom' }
            )
            .select('id')
            .maybeSingle();

          if (error) {
            logger.error('alerts/subscribe: Supabase upsert failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          await recordAudit(c, {
            action: 'alert.subscribe',
            entityType: 'alert_subscription',
            entityId: typeof data?.id === 'string' ? data.id : null,
            actorId: user.id,
            actorRole: user.role,
            outcome: 'success',
            requestId,
            detail: { radiusM: parsed.data.radiusM, active: parsed.data.active },
          });

          return c.json({ id: data?.id ?? null, requestId }, 200);
        } catch (thrown) {
          logger.error('alerts/subscribe: unexpected failure', {
            requestId,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
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
      async (c) => {
        const requestId = c.get('requestId');
        const user = c.get('user');
        if (!user) {
          // auth() always sets this before next() — defensive only, never
          // exercised in practice.
          return c.json(buildGenericErrorBody(requestId), 401);
        }

        const body = await c.req.json().catch(() => undefined);
        const parsed = pushSubscriptionRegisterSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        try {
          const supabase = createSupabaseAdmin(c.env);
          // `endpoint` carries the table's own unique constraint, so
          // registering the same browser subscription twice updates the
          // existing row instead of hitting a unique-violation.
          const { data, error } = await supabase
            .from('push_subscriptions')
            .upsert(
              {
                user_id: user.id,
                endpoint: parsed.data.endpoint,
                p256dh: parsed.data.p256dh,
                auth_key: parsed.data.authKey,
              },
              { onConflict: 'endpoint' }
            )
            .select('id')
            .maybeSingle();

          if (error) {
            logger.error('alerts/push-subscription: Supabase upsert failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          await recordAudit(c, {
            action: 'push.subscribe',
            entityType: 'push_subscription',
            entityId: typeof data?.id === 'string' ? data.id : null,
            actorId: user.id,
            actorRole: user.role,
            outcome: 'success',
            requestId,
            detail: null,
          });

          return c.json({ id: data?.id ?? null, requestId }, 200);
        } catch (thrown) {
          logger.error('alerts/push-subscription: unexpected failure', {
            requestId,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    );
}

export const alerts = createAlerts();
