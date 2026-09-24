import { Hono } from 'hono';
import {
  bloodSearchQuerySchema,
  bloodUpdateRequestSchema,
  hospitalsResponseSchema,
  bloodSearchResponseSchema,
  bloodAvailabilityDtoSchema,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { parseBbox } from '@avash/geo';
import { BLOOD_UPDATE_RATE_LIMIT, buildAuditEntry, writeAuditEntry, type RateLimitRedisLike } from '@avash/security';
import { auth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { createAuditSink } from '../lib/auditSink';
import { toHospitalDto, toBloodAvailabilityDto } from '../lib/resourceDto';
import { toNumberOrNull } from '../lib/numeric';
import type { AppEnv, Bindings } from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `HOSPITAL_RESULT_LIMIT` (§14) — caps `GET /hospitals`' row count. */
const HOSPITAL_RESULT_LIMIT = 200;
/** `RESOURCES_CACHE_TTL_S` (§14) — edge cache for resource reads. */
const RESOURCES_CACHE_TTL_S = 'public, max-age=0, s-maxage=60, stale-while-revalidate=120';

export interface CreateResourcesOptions {
  /** Test seam — route tests inject a fake in place of a real Upstash client. */
  redisFactory?: (env: Bindings) => RateLimitRedisLike;
}

/**
 * Public GETs stay cors+headers only (decision J — no rate-limit on this
 * slice's reads); the write is auth+rate-limit, with the handler-level
 * staff check as the actual authorization boundary (see PATCH below — the
 * Worker's Supabase client uses the service-role key, which bypasses RLS
 * entirely).
 */
export function createResources(options?: CreateResourcesOptions) {
  return new Hono<AppEnv>()
    .get('/hospitals', async (c) => {
      const requestId = c.get('requestId');
      const bbox = parseBbox(c.req.query('bbox'));
      if (!bbox.ok) {
        return c.json(buildGenericErrorBody(requestId), 400);
      }

      try {
        const supabase = createSupabaseAdmin(c.env);
        const { data, error } = await supabase
          .from('hospital_locations')
          .select('*')
          .gte('lon', bbox.bbox.minLon)
          .lte('lon', bbox.bbox.maxLon)
          .gte('lat', bbox.bbox.minLat)
          .lte('lat', bbox.bbox.maxLat)
          .limit(HOSPITAL_RESULT_LIMIT);

        if (error) {
          logger.error('resources/hospitals: Supabase read failed', { requestId });
          return c.json(buildGenericErrorBody(requestId), 503);
        }

        const rows = (data ?? []) as Record<string, unknown>[];
        const hospitals = rows.map((row) => toHospitalDto(row));

        const body = hospitalsResponseSchema.parse({
          hospitals,
          generatedAt: new Date().toISOString(),
          requestId,
        });
        c.header('Cache-Control', RESOURCES_CACHE_TTL_S);
        return c.json(body, 200);
      } catch (error) {
        logger.error('resources/hospitals: unexpected failure', {
          requestId,
          message: error instanceof Error ? error.message : String(error),
        });
        return c.json(buildGenericErrorBody(requestId), 503);
      }
    })
    .get('/blood', async (c) => {
      const requestId = c.get('requestId');
      const parsed = bloodSearchQuerySchema.safeParse({
        bloodGroup: c.req.query('bloodGroup'),
        lat: Number(c.req.query('lat')),
        lng: Number(c.req.query('lng')),
        radiusM: c.req.query('radius') ? Number(c.req.query('radius')) : undefined,
      });
      if (!parsed.success) {
        return c.json(buildGenericErrorBody(requestId), 400);
      }

      try {
        const supabase = createSupabaseAdmin(c.env);
        const { data, error } = await supabase.rpc('blood_within_radius', {
          p_blood_group: parsed.data.bloodGroup,
          p_lat: parsed.data.lat,
          p_lon: parsed.data.lng,
          p_radius_m: parsed.data.radiusM,
        });

        if (error) {
          logger.error('resources/blood: RPC failed', { requestId });
          return c.json(buildGenericErrorBody(requestId), 503);
        }

        const rows = (data ?? []) as Record<string, unknown>[];
        const results = rows.map((row) => toBloodAvailabilityDto(row));

        const body = bloodSearchResponseSchema.parse({
          results,
          generatedAt: new Date().toISOString(),
          requestId,
        });
        c.header('Cache-Control', RESOURCES_CACHE_TTL_S);
        return c.json(body, 200);
      } catch (error) {
        logger.error('resources/blood: unexpected failure', {
          requestId,
          message: error instanceof Error ? error.message : String(error),
        });
        return c.json(buildGenericErrorBody(requestId), 503);
      }
    })
    .patch(
      '/blood/:id',
      // The capability is a cheap first gate, not the boundary — step 2
      // below is. It exists so revoking someone's hospital_staff role
      // locks them out immediately, without also having to find and delete
      // their verified_hospital_staff membership rows.
      auth({ capability: 'inventory:write' }),
      rateLimit({
        guard: 'blood-update',
        window: 'minute',
        windowSeconds: 60,
        limit: BLOOD_UPDATE_RATE_LIMIT.perMinute,
        keyStrategy: 'user',
        redisFactory: options?.redisFactory,
      }),
      async (c) => {
        const requestId = c.get('requestId');
        const id = c.req.param('id');
        if (!UUID_PATTERN.test(id)) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }
        const body = await c.req.json().catch(() => undefined);
        const parsed = bloodUpdateRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        const user = c.get('user');
        if (!user) {
          // auth() always sets this before next() — defensive only, never
          // exercised in practice.
          return c.json(buildGenericErrorBody(requestId), 401);
        }

        try {
          const supabase = createSupabaseAdmin(c.env);

          // Step 1 — resolve the target row's hospital_id. A missing row
          // is a 404 before any authorization check runs.
          const { data: invRows, error: invError } = await supabase
            .from('blood_inventory')
            .select('id, hospital_id')
            .eq('id', id)
            .limit(1);

          if (invError) {
            logger.error('resources/blood PATCH: inventory read failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const invRow = (invRows ?? [])[0] as Record<string, unknown> | undefined;
          if (!invRow) {
            return c.json(buildGenericErrorBody(requestId), 404);
          }
          const hospitalId = String(invRow.hospital_id);

          // Step 2 — the actual authorization boundary. The service-role
          // key bypasses RLS entirely, so this handler-level check is the
          // only thing standing between an authenticated caller and any
          // hospital's inventory row, not defense-in-depth.
          const { data: staffRows, error: staffError } = await supabase
            .from('verified_hospital_staff')
            .select('user_id, hospital_id')
            .eq('user_id', user.id)
            .eq('hospital_id', hospitalId)
            .limit(1);

          if (staffError) {
            logger.error('resources/blood PATCH: staff read failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          if (!staffRows || staffRows.length === 0) {
            return c.json(buildGenericErrorBody(requestId), 403);
          }

          // Step 3 — only now write.
          const nowIso = new Date().toISOString();
          const { data: updatedRows, error: updateError } = await supabase
            .from('blood_inventory')
            .update({
              units_available: parsed.data.unitsAvailable,
              platelet_units: parsed.data.plateletUnits,
              updated_by: user.id,
              updated_at: nowIso,
            })
            .eq('id', id)
            .select('*');

          if (updateError) {
            logger.error('resources/blood PATCH: update failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const updatedRow = (updatedRows ?? [])[0] as Record<string, unknown> | undefined;
          if (!updatedRow) {
            return c.json(buildGenericErrorBody(requestId), 404);
          }

          // Best-effort, isolated (see admin-users.ts's PATCH handler for
          // why this can't share the outer try/catch): the write already
          // took effect above.
          try {
            const sink = createAuditSink(supabase);
            const entry = buildAuditEntry({
              action: 'blood.update',
              entityType: 'blood_inventory',
              entityId: id,
              actorId: user.id,
              actorRole: user.role,
              outcome: 'success',
              requestId,
              detail: {
                unitsAvailable: parsed.data.unitsAvailable,
                plateletUnits: parsed.data.plateletUnits,
              },
            });
            const { error: auditLogError } = await writeAuditEntry(sink, entry);
            if (auditLogError) {
              logger.error('resources/blood PATCH: updated but audit_log write failed', { requestId });
            }
          } catch (auditThrown) {
            logger.error('resources/blood PATCH: updated but audit_log write threw', {
              requestId,
              message: auditThrown instanceof Error ? auditThrown.message : String(auditThrown),
            });
          }

          const { data: hospRows, error: hospError } = await supabase
            .from('hospital_locations')
            .select('*')
            .eq('id', hospitalId)
            .limit(1);

          if (hospError) {
            logger.error('resources/blood PATCH: hospital read failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const hospRow = (hospRows ?? [])[0] as Record<string, unknown> | undefined;
          const hospital = hospRow
            ? toHospitalDto(hospRow)
            : {
                id: hospitalId,
                name: '',
                address: null,
                phone: null,
                verified: false,
                lat: 0,
                lng: 0,
              };

          const responseBody = bloodAvailabilityDtoSchema.parse({
            inventoryId: Number(updatedRow.id),
            hospital,
            bloodGroup: updatedRow.blood_group,
            unitsAvailable: Number(updatedRow.units_available),
            plateletUnits: toNumberOrNull(updatedRow.platelet_units) ?? 0,
            // No search origin exists for a direct PATCH — 0 is a
            // placeholder distance, never used by the caller here.
            distanceM: 0,
            updatedAt: String(updatedRow.updated_at),
          });
          return c.json(responseBody, 200);
        } catch (error) {
          logger.error('resources/blood PATCH: unexpected failure', {
            requestId,
            message: error instanceof Error ? error.message : String(error),
          });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    );
}

export const resources = createResources();
