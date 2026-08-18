import { Hono } from 'hono';
import { z } from 'zod';
import {
  listQueryFor,
  paginatedResponseSchema,
  auditEntrySchema,
  auditActionSchema,
  LIST_PAGE_SIZE_MAX,
  type AuditEntry,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { ROLE_ASSIGNMENT_RATE_LIMIT, type RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { parseListQuery, buildPageMeta } from '../lib/listQuery';
import type { AppEnv, Bindings } from '../types';

/** `AUDIT_LOG_PAGE_SIZE_DEFAULT` (§14) — default page size for this route (decision, mirrors `ADMIN_USER_PAGE_SIZE`'s pattern). */
const AUDIT_LOG_PAGE_SIZE_DEFAULT = 50;

/**
 * No sortable column set exists for this route — every caller gets the
 * same `occurred_at desc` order (matching `role_assignments`'s prior art).
 * `pageSize` clamps to `LIST_PAGE_SIZE_MAX` instead of rejecting an
 * over-large request, unlike `admin-users.ts`'s `adminUsersListQuerySchema`
 * — a deliberately different choice for this route so a caller who asks
 * for too much still gets a usable page back.
 */
const auditLogListQuerySchema = listQueryFor([]).extend({
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(AUDIT_LOG_PAGE_SIZE_DEFAULT)
    .transform((value) => Math.min(value, LIST_PAGE_SIZE_MAX)),
});

const auditLogFilterQuerySchema = z.object({
  action: auditActionSchema.optional(),
  actorId: z.string().uuid().optional(),
});

/**
 * Maps an `audit_log` row to the frozen `auditEntrySchema` shape. A row
 * that fails to parse (unexpected shape) is dropped, never rendered
 * half-parsed (mirrors `admin-users.ts`'s `toManagedUser`).
 */
function toAuditEntry(row: Record<string, unknown>): AuditEntry | null {
  const parsed = auditEntrySchema.safeParse({
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? null,
    actorId: row.actor_id ?? null,
    actorRole: row.actor_role ?? null,
    outcome: row.outcome,
    requestId: row.request_id ?? '',
    detail: row.detail ?? null,
  });
  return parsed.success ? parsed.data : null;
}

export interface CreateAuditLogOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Admin-only read surface for `audit_log` (decision D) — an audit trail
 * nobody can read is a table, not a control. Reuses
 * `ROLE_ASSIGNMENT_RATE_LIMIT`, matching `GET /api/admin/users`.
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
    async (c) => {
      const requestId = c.get('requestId');

      const filterQuery = auditLogFilterQuerySchema.safeParse({
        action: c.req.query('action'),
        actorId: c.req.query('actorId'),
      });
      if (!filterQuery.success) {
        return c.json(buildGenericErrorBody(requestId), 400);
      }

      const parsedQuery = parseListQuery(c, auditLogListQuerySchema);
      if (!parsedQuery.ok) {
        return parsedQuery.response;
      }
      const { page, pageSize } = parsedQuery.query;

      try {
        const supabase = createSupabaseAdmin(c.env);
        let query = supabase.from('audit_log').select('*', { count: 'exact' }).order('occurred_at', {
          ascending: false,
        });
        if (filterQuery.data.action) {
          query = query.eq('action', filterQuery.data.action);
        }
        if (filterQuery.data.actorId) {
          query = query.eq('actor_id', filterQuery.data.actorId);
        }

        const start = (page - 1) * pageSize;
        const end = start + pageSize - 1;
        const { data, error, count } = await query.range(start, end);

        if (error) {
          logger.error('admin/audit-log: read failed', { requestId });
          return c.json(buildGenericErrorBody(requestId), 503);
        }

        const rows = (data ?? []) as Record<string, unknown>[];
        const items = rows.map((row) => toAuditEntry(row)).filter((entry): entry is AuditEntry => entry !== null);

        const responseBody = paginatedResponseSchema(auditEntrySchema).parse({
          items,
          page: buildPageMeta({
            page,
            pageSize,
            total: count ?? null,
            returned: rows.length,
            sort: null,
            dir: 'desc',
          }),
          requestId,
        });
        return c.json(responseBody, 200);
      } catch (thrown) {
        logger.error('admin/audit-log: unexpected failure', {
          requestId,
          message: thrown instanceof Error ? thrown.message : String(thrown),
        });
        return c.json(buildGenericErrorBody(requestId), 503);
      }
    }
  );
}

export const auditLog = createAuditLog();
