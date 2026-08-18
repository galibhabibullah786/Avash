import { Hono } from 'hono';
import { z } from 'zod';
import {
  announcementCreateSchema,
  announcementSchema,
  listQueryFor,
  paginatedResponseSchema,
  ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { ANNOUNCEMENT_CREATE_RATE_LIMIT, isAdmin, type RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { recordAudit } from '../lib/auditWrite';
import { parseListQuery, buildPageMeta } from '../lib/listQuery';
import { toAnnouncementDto, announcementVisibleTo } from '../lib/announcementDto';
import type { AppEnv, Bindings } from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// No sortable column set exists for this route yet — every caller gets
// the same `created_at desc` order (see the handler below).
const announcementsListQuerySchema = listQueryFor([]);

/**
 * The caller's own point, required for the `ST_DWithin`-equivalent
 * proximity filter (decision B, decision H). Bounds mirror
 * `announcementCreateSchema`'s lat/lng exactly.
 */
const announcementsGeoQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export interface CreateAnnouncementsOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Author-broadcast announcements (decision A — a distinct table and route
 * from `alert_subscriptions`). `GET /` is authenticated, not public
 * (decision H).
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
      async (c) => {
        const requestId = c.get('requestId');
        const user = c.get('user');
        if (!user) {
          // auth() always sets this before next() — defensive only, never
          // exercised in practice.
          return c.json(buildGenericErrorBody(requestId), 401);
        }

        const body = await c.req.json().catch(() => undefined);
        const parsed = announcementCreateSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        try {
          const supabase = createSupabaseAdmin(c.env);
          const nowIso = new Date().toISOString();

          // Cap check before insert (decision — §14
          // ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR). Query-side filter on
          // `expires_at`, per the migration note: the live-rows index is a
          // plain btree, not a partial one, because `now()` cannot appear
          // in a partial-index predicate. Reads row ids rather than a
          // `head: true` exact count — PostgREST's count comes back on a
          // `Content-Range` response header, not the body, so counting the
          // returned rows keeps this checkable against the same
          // body-based PostgREST test double every other route uses.
          const { data: liveRows, error: countError } = await supabase
            .from('announcements')
            .select('id')
            .eq('author_id', user.id)
            .gt('expires_at', nowIso);

          if (countError) {
            logger.error('announcements: active-count read failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }
          if ((liveRows?.length ?? 0) >= ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR) {
            return c.json(buildGenericErrorBody(requestId), 409);
          }

          const { data, error } = await supabase
            .from('announcements')
            .insert({
              author_id: user.id,
              title: parsed.data.title,
              body: parsed.data.body,
              geom: { type: 'Point', coordinates: [parsed.data.lng, parsed.data.lat] },
              radius_m: parsed.data.radiusM,
              target_roles: parsed.data.targetRoles,
              expires_at: parsed.data.expiresAt,
            })
            .select('id, author_id, created_at')
            .single();

          if (error || !data) {
            logger.error('announcements: insert failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          // Audit detail flattens targetRoles into a single dotted scalar
          // key (decision — auditDetailSchema rejects arrays/objects and
          // caps at 12 keys).
          await recordAudit(c, {
            action: 'announcement.create',
            entityType: 'announcement',
            entityId: String(data.id),
            actorId: user.id,
            actorRole: user.role,
            outcome: 'success',
            requestId,
            detail: {
              'target.roles': parsed.data.targetRoles.join(','),
              radiusM: parsed.data.radiusM,
            },
          });

          const responseBody = announcementSchema.parse({
            id: data.id,
            authorId: data.author_id ?? user.id,
            title: parsed.data.title,
            body: parsed.data.body,
            lat: parsed.data.lat,
            lng: parsed.data.lng,
            radiusM: parsed.data.radiusM,
            targetRoles: parsed.data.targetRoles,
            expiresAt: parsed.data.expiresAt,
            createdAt: data.created_at,
          });
          return c.json(responseBody, 201);
        } catch (thrown) {
          logger.error('announcements: unexpected failure creating', {
            requestId,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
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
      async (c) => {
        const requestId = c.get('requestId');
        const user = c.get('user');
        if (!user) {
          // auth() always sets this before next() — defensive only, never
          // exercised in practice.
          return c.json(buildGenericErrorBody(requestId), 401);
        }

        const geoQuery = announcementsGeoQuerySchema.safeParse({
          lat: c.req.query('lat'),
          lng: c.req.query('lng'),
        });
        if (!geoQuery.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        const parsedQuery = parseListQuery(c, announcementsListQuerySchema);
        if (!parsedQuery.ok) {
          return parsedQuery.response;
        }
        const { page, pageSize } = parsedQuery.query;

        try {
          const supabase = createSupabaseAdmin(c.env);
          const nowIso = new Date().toISOString();

          // `expires_at > now()` is the only predicate the query itself can
          // express (decision B / the migration note — no partial index,
          // filtered here instead). Role targeting and the proximity check
          // cannot be expressed by PostgREST filters without an RPC this
          // table does not have, so both run in-process below.
          const { data, error } = await supabase.from('announcements').select('*').gt('expires_at', nowIso);

          if (error) {
            logger.error('announcements: list read failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const rows = (data ?? []) as Record<string, unknown>[];
          const visibleRows = rows.filter((row) =>
            announcementVisibleTo(row, user.role, geoQuery.data.lat, geoQuery.data.lng)
          );
          visibleRows.sort((a, b) => {
            const aTime = new Date(String(a.created_at)).getTime();
            const bTime = new Date(String(b.created_at)).getTime();
            return bTime - aTime;
          });

          const start = (page - 1) * pageSize;
          const pageRows = visibleRows.slice(start, start + pageSize);
          const items = pageRows
            .map((row) => toAnnouncementDto(row))
            .filter((item): item is NonNullable<typeof item> => item !== null);

          const responseBody = paginatedResponseSchema(announcementSchema).parse({
            items,
            page: buildPageMeta({
              page,
              pageSize,
              total: visibleRows.length,
              returned: pageRows.length,
              sort: null,
              dir: 'desc',
            }),
            requestId,
          });
          return c.json(responseBody, 200);
        } catch (thrown) {
          logger.error('announcements: unexpected failure listing', {
            requestId,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
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
      async (c) => {
        const requestId = c.get('requestId');
        const user = c.get('user');
        if (!user) {
          // auth() always sets this before next() — defensive only, never
          // exercised in practice.
          return c.json(buildGenericErrorBody(requestId), 401);
        }

        const id = c.req.param('id');
        if (!UUID_PATTERN.test(id)) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        try {
          const supabase = createSupabaseAdmin(c.env);

          const { data: rows, error: readError } = await supabase
            .from('announcements')
            .select('id, author_id')
            .eq('id', id)
            .limit(1);

          if (readError) {
            logger.error('announcements/delete: read failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const row = (rows ?? [])[0] as Record<string, unknown> | undefined;
          if (!row) {
            return c.json(buildGenericErrorBody(requestId), 404);
          }

          // Author-or-admin only. The service-role key bypasses RLS
          // entirely, so this handler-level check is the actual
          // authorization boundary, not defense-in-depth.
          const authorId = row.author_id ?? null;
          if (authorId !== user.id && !isAdmin(user.role)) {
            return c.json(buildGenericErrorBody(requestId), 403);
          }

          const { error: deleteError } = await supabase.from('announcements').delete().eq('id', id);
          if (deleteError) {
            logger.error('announcements/delete: delete failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          // Decision E: record who deleted which entity and when — never
          // the row's title/body/geometry, which auditDetailSchema's
          // scalar-only, 12-key cap makes both impossible and undesirable
          // to store for location data.
          await recordAudit(c, {
            action: 'announcement.delete',
            entityType: 'announcement',
            entityId: id,
            actorId: user.id,
            actorRole: user.role,
            outcome: 'success',
            requestId,
            detail: null,
          });

          return c.body(null, 204);
        } catch (thrown) {
          logger.error('announcements/delete: unexpected failure', {
            requestId,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    );
}

export const announcements = createAnnouncements();
