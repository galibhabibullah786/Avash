import { Hono } from 'hono';
import { buildGenericErrorBody } from '@avash/logger';
import { ROLE_ASSIGNMENT_RATE_LIMIT, type RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv, Bindings } from '../types';

export interface CreateAuditLogOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Admin-only read surface for `audit_log` (decision D) — an audit trail
 * nobody can read is a table, not a control. Reuses
 * `ROLE_ASSIGNMENT_RATE_LIMIT`, matching `GET /api/admin/users`; no
 * separate rate-limit constant exists for this route. Route body lands in
 * Phase 1 (A-T06); this stub freezes the final middleware chain and mount
 * shape.
 */
export function createAuditLog(options?: CreateAuditLogOptions) {
  return new Hono<AppEnv>().get(
    '/',
    auth({ capability: 'roles:manage' }),
    rateLimit({
      guard: 'audit-log-read',
      window: 'minute',
      windowSeconds: 60,
      limit: ROLE_ASSIGNMENT_RATE_LIMIT.perMinute,
      keyStrategy: 'user',
      redisFactory: options?.redisFactory,
    }),
    (c) => c.json(buildGenericErrorBody(c.get('requestId')), 501)
  );
}

export const auditLog = createAuditLog();
