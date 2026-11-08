import { Hono } from 'hono';
import {
  hospitalCreateRequestSchema,
  hospitalUpdateRequestSchema,
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
    
    .post(
      '/hospitals',
      auth({ capability: 'hospitals:manage' }),
      async (c) => {
        const requestId = c.get('requestId');
        const user = c.get('user')!;
        
        const body = await c.req.json().catch(() => undefined);
        const parsed = hospitalCreateRequestSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(buildGenericErrorBody(requestId), 400);
        }

        try {
          const supabase = createSupabaseAdmin(c.env);
          
          // PostGIS formatting (GeoJSON standard format accepted by Supabase/PostgREST)
          const geom = { type: 'Point', coordinates: [parsed.data.lng, parsed.data.lat] };
          
          const { data, error } = await supabase
            .from('hospitals')
            .insert({
              name: parsed.data.name,
              geom,
              address: parsed.data.address,
              phone: parsed.data.phone,
              verified: parsed.data.verified,
            })
            .select('*')
            .single();

          if (error) {
            logger.error('resources/hospitals POST: insert failed', { requestId, error });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          // Also insert 8 blood groups initialized to 0
          const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
          const updatedBy = UUID_PATTERN.test(user.id) ? user.id : null;
          const inventoryRows = bloodGroups.map(bg => ({
            hospital_id: data.id,
            blood_group: bg,
            units_available: 0,
            platelet_units: 0,
            updated_by: updatedBy,
          }));
          
          const { error: invErr } = await supabase.from('blood_inventory').insert(inventoryRows);
          if (invErr && updatedBy !== null) {
            await supabase.from('blood_inventory').insert(
              bloodGroups.map((bg) => ({
                hospital_id: data.id,
                blood_group: bg,
                units_available: 0,
                platelet_units: 0,
                updated_by: null,
              }))
            );
          }

          // We query from hospital_locations view to get lat/lng correctly formatted
          const { data: viewData, error: viewError } = await supabase
            .from('hospital_locations')
            .select('*')
            .eq('id', data.id)
            .single();
            
          if (viewError || !viewData) {
            return c.json({
              id: String(data.id),
              name: parsed.data.name,
              address: parsed.data.address ?? null,
              phone: parsed.data.phone ?? null,
              verified: parsed.data.verified,
              lat: parsed.data.lat,
              lng: parsed.data.lng,
            }, 201);
          }

          return c.json(toHospitalDto(viewData), 201);
        } catch {
          logger.error('resources/hospitals POST: unexpected failure', { requestId });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    )
    .patch(
      '/hospitals/:id',
      auth({ capability: 'hospitals:manage' }),
      async (c) => {
        const requestId = c.get('requestId');
        const id = c.req.param('id');
        if (!UUID_PATTERN.test(id)) return c.json(buildGenericErrorBody(requestId), 400);
        
        const body = await c.req.json().catch(() => undefined);
        const parsed = hospitalUpdateRequestSchema.safeParse(body);
        if (!parsed.success) return c.json(buildGenericErrorBody(requestId), 400);

        try {
          const supabase = createSupabaseAdmin(c.env);
          
          const updateData: Record<string, unknown> = {};
          if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
          if (parsed.data.address !== undefined) updateData.address = parsed.data.address;
          if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
          if (parsed.data.verified !== undefined) updateData.verified = parsed.data.verified;
          if (parsed.data.lat !== undefined && parsed.data.lng !== undefined) {
            updateData.geom = { type: 'Point', coordinates: [parsed.data.lng, parsed.data.lat] };
          }

          const { error: updateError, data: updatedData } = await supabase
            .from('hospitals')
            .update(updateData)
            .eq('id', id)
            .select('*');

          if (updateError) {
            logger.error('resources/hospitals PATCH: update failed', { requestId, error: updateError });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const { data: viewData, error: viewError } = await supabase
            .from('hospital_locations')
            .select('*')
            .eq('id', id)
            .single();
            
          if (viewError || !viewData) {
            const row = (updatedData ?? [])[0] as Record<string, unknown> | undefined;
            if (!row && (!updatedData || (updatedData as unknown[]).length === 0)) {
              return c.json(buildGenericErrorBody(requestId), 404);
            }
            return c.json({
              id,
              name: parsed.data.name ?? String(row?.name ?? ''),
              address: (parsed.data.address !== undefined ? parsed.data.address : row?.address as string) ?? null,
              phone: (parsed.data.phone !== undefined ? parsed.data.phone : row?.phone as string) ?? null,
              verified: (parsed.data.verified !== undefined ? parsed.data.verified : row?.verified as boolean) ?? false,
              lat: parsed.data.lat ?? 0,
              lng: parsed.data.lng ?? 0,
            }, 200);
          }

          return c.json(toHospitalDto(viewData), 200);
        } catch {
          logger.error('resources/hospitals PATCH: unexpected failure', { requestId });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    )
    .delete(
      '/hospitals/:id',
      auth({ capability: 'hospitals:manage' }),
      async (c) => {
        const requestId = c.get('requestId');
        const id = c.req.param('id');
        if (!UUID_PATTERN.test(id)) return c.json(buildGenericErrorBody(requestId), 400);

        try {
          const supabase = createSupabaseAdmin(c.env);
          const { error } = await supabase
            .from('hospitals')
            .delete()
            .eq('id', id);

          if (error) {
            logger.error('resources/hospitals DELETE: delete failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }
          return c.body(null, 204);
        } catch {
          logger.error('resources/hospitals DELETE: unexpected failure', { requestId });
          return c.json(buildGenericErrorBody(requestId), 503);
        }
      }
    )
    
    .get('/hospitals/:id/blood', auth({ capability: 'hospitals:manage' }), async (c) => {
      const requestId = c.get('requestId');
      const id = c.req.param('id');
      if (!UUID_PATTERN.test(id)) return c.json(buildGenericErrorBody(requestId), 400);

      try {
        const supabase = createSupabaseAdmin(c.env);
        const { data: initialData, error } = await supabase
          .from('blood_inventory')
          .select('*')
          .eq('hospital_id', id);

        if (error) return c.json(buildGenericErrorBody(requestId), 503);
        
        let data = initialData ?? [];
        // If hospital has no inventory rows yet, initialize 8 blood groups
        if (data.length === 0) {
          const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
          const inventoryRows = bloodGroups.map((bg) => ({
            hospital_id: id,
            blood_group: bg,
            units_available: 0,
            platelet_units: 0,
            updated_by: null,
          }));
          await supabase.from('blood_inventory').insert(inventoryRows);
          const refetch = await supabase
            .from('blood_inventory')
            .select('*')
            .eq('hospital_id', id);
          data = refetch.data ?? [];
        }

        return c.json({ inventory: data ?? [] }, 200);
      } catch {
        return c.json(buildGenericErrorBody(requestId), 503);
      }
    })

    .get('/blood', async (c) => {
      const requestId = c.get('requestId');
      const latQuery = c.req.query('lat');
      const lngQuery = c.req.query('lng');
      const parsed = bloodSearchQuerySchema.safeParse({
        bloodGroup: c.req.query('bloodGroup'),
        lat: latQuery !== undefined && latQuery !== '' ? Number(latQuery) : undefined,
        lng: lngQuery !== undefined && lngQuery !== '' ? Number(lngQuery) : undefined,
        radiusM: c.req.query('radius') ? Number(c.req.query('radius')) : undefined,
      });
      if (!parsed.success) {
        return c.json(buildGenericErrorBody(requestId), 400);
      }

      try {
        const supabase = createSupabaseAdmin(c.env);
        let results: ReturnType<typeof toBloodAvailabilityDto>[] = [];

        if (parsed.data.lat !== undefined && parsed.data.lng !== undefined) {
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
          results = rows.map((row) => toBloodAvailabilityDto(row));
        } else {
          const [invRes, hospRes] = await Promise.all([
            supabase
              .from('blood_inventory')
              .select('*')
              .eq('blood_group', parsed.data.bloodGroup)
              .order('units_available', { ascending: false }),
            supabase
              .from('hospital_locations')
              .select('*')
              .limit(HOSPITAL_RESULT_LIMIT),
          ]);

          if (invRes.error || hospRes.error) {
            logger.error('resources/blood: all-records read failed', { requestId });
            return c.json(buildGenericErrorBody(requestId), 503);
          }

          const hospMap = new Map<string, Record<string, unknown>>();
          for (const h of (hospRes.data ?? []) as Record<string, unknown>[]) {
            hospMap.set(String(h.id), h);
          }

          const rows: Record<string, unknown>[] = [];
          for (const inv of (invRes.data ?? []) as Record<string, unknown>[]) {
            const h = hospMap.get(String(inv.hospital_id));
            if (!h) continue;
            rows.push({
              inventory_id: inv.id,
              hospital_id: h.id,
              hospital_name: h.name,
              hospital_address: h.address,
              hospital_phone: h.phone,
              hospital_verified: h.verified,
              hospital_lat: h.lat,
              hospital_lon: h.lon,
              blood_group: inv.blood_group,
              units_available: inv.units_available,
              platelet_units: inv.platelet_units,
              updated_at: inv.updated_at,
              distance_m: null,
            });
          }
          results = rows.map((row) => toBloodAvailabilityDto(row));
        }

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
      // below is. It exists so revoking someone's moderator role
      // locks them out immediately, without also having to find and delete
      // their verified_moderator membership rows.
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
        const ID_PATTERN = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
        if (!ID_PATTERN.test(id)) {
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

          // Step 3 — only now write.
          const nowIso = new Date().toISOString();
          const updatedBy = UUID_PATTERN.test(user.id) ? user.id : null;
          let { data: updatedRows, error: updateError } = await supabase
            .from('blood_inventory')
            .update({
              units_available: parsed.data.unitsAvailable,
              platelet_units: parsed.data.plateletUnits,
              updated_by: updatedBy,
              updated_at: nowIso,
            })
            .eq('id', id)
            .select('*');

          if (updateError && updatedBy !== null) {
            const retry = await supabase
              .from('blood_inventory')
              .update({
                units_available: parsed.data.unitsAvailable,
                platelet_units: parsed.data.plateletUnits,
                updated_by: null,
                updated_at: nowIso,
              })
              .eq('id', id)
              .select('*');
            updatedRows = retry.data;
            updateError = retry.error;
          }

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
