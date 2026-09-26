import { Hono } from 'hono';
import { z } from 'zod';
import {
  riskMapResponseSchema,
  riskDetailResponseSchema,
  riskFactorSchema,
  horizonWeeksSchema,
  RISK_MAP_DEFAULT_HORIZON_WEEKS,
  STUB_MODEL_VERSION,
} from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { parseBbox, type Bbox } from '@avash/geo';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { toWeatherObservationDto } from '../lib/weatherDto';
import { toNumberOrNull } from '../lib/numeric';
import type { AppEnv } from '../types';

/** `RISK_MAP_CACHE_TTL_S` (§14) — edge cache for risk-map reads. */
const RISK_MAP_CACHE_TTL_S = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

const regionIdParamSchema = z.string().uuid();
const topFactorsArraySchema = z.array(riskFactorSchema);

/**
 * `generated_at` columns are nullable (`risk_predictions.generated_at`
 * has no `not null`), but `riskMapFeaturePropertiesSchema.generatedAt` is
 * a required string — `String(null)` would otherwise yield the literal
 * `"null"`, which passes that schema and then lexically outranks a real
 * ISO timestamp in the newest-generatedAt reduction below, silently
 * poisoning the collection's top-level `generatedAt`. The epoch sentinel
 * satisfies the required-string contract without ever winning that
 * comparison.
 */
const UNKNOWN_GENERATED_AT = new Date(0).toISOString();

function toIsoString(value: unknown): string {
  return value === null || value === undefined ? UNKNOWN_GENERATED_AT : String(value);
}

function parseHorizon(raw: string | undefined): { ok: true; horizonWeeks: 2 | 4 } | { ok: false } {
  if (raw === undefined) {
    return { ok: true, horizonWeeks: RISK_MAP_DEFAULT_HORIZON_WEEKS };
  }
  const parsed = horizonWeeksSchema.safeParse(Number(raw));
  return parsed.success ? { ok: true, horizonWeeks: parsed.data } : { ok: false };
}

/**
 * `[]` when `top_factors` is null/undefined or fails validation against
 * `riskFactorSchema` as a whole — never `null`, never a raw `unknown`
 * value forwarded to the client (R7).
 */
function parseTopFactors(raw: unknown): z.infer<typeof riskFactorSchema>[] {
  if (raw === null || raw === undefined) {
    return [];
  }
  const parsed = topFactorsArraySchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * `GET /api/risk-map` — reads `region_risk_geojson`, filtered by
 * `horizon_weeks` and, when `?bbox=` is present, by the four range
 * filters a bounding-box overlap test needs (`max_lon >= minLon`,
 * `min_lon <= maxLon`, `max_lat >= minLat`, `min_lat <= maxLat`).
 */
export const riskMap = new Hono<AppEnv>().get('/', async (c) => {
  const requestId = c.get('requestId');
  const horizon = parseHorizon(c.req.query('horizon'));
  if (!horizon.ok) {
    return c.json(buildGenericErrorBody(requestId), 400);
  }

  const bboxRaw = c.req.query('bbox');
  let bbox: Bbox | undefined;
  if (bboxRaw !== undefined) {
    const parsed = parseBbox(bboxRaw);
    if (!parsed.ok) {
      return c.json(buildGenericErrorBody(requestId), 400);
    }
    bbox = parsed.bbox;
  }

  try {
    const supabase = createSupabaseAdmin(c.env);
    let query = supabase.from('region_risk_geojson').select('*').eq('horizon_weeks', horizon.horizonWeeks);

    if (bbox) {
      query = query
        .gte('max_lon', bbox.minLon)
        .lte('min_lon', bbox.maxLon)
        .gte('max_lat', bbox.minLat)
        .lte('min_lat', bbox.maxLat);
    }

    const { data, error } = await query;
    if (error) {
      logger.error('risk-map: Supabase read failed', { requestId });
      return c.json(buildGenericErrorBody(requestId), 503);
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const features = rows.map((row) => ({
      type: 'Feature' as const,
      geometry: row.geometry,
      properties: {
        regionId: String(row.region_id),
        regionName: String(row.region_name),
        riskScore: toNumberOrNull(row.risk_score) ?? 0,
        riskLevel: row.risk_level,
        horizonWeeks: Number(row.horizon_weeks),
        generatedAt: toIsoString(row.generated_at),
      },
    }));

    let generatedAt: string | null = null;
    for (const feature of features) {
      if (generatedAt === null || feature.properties.generatedAt > generatedAt) {
        generatedAt = feature.properties.generatedAt;
      }
    }

    const body = riskMapResponseSchema.parse({
      type: 'FeatureCollection',
      features,
      horizonWeeks: horizon.horizonWeeks,
      generatedAt,
      requestId,
    });
    c.header('Cache-Control', RISK_MAP_CACHE_TTL_S);
    return c.json(body, 200);
  } catch (error) {
    logger.error('risk-map: unexpected failure', {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return c.json(buildGenericErrorBody(requestId), 503);
  }
});

/**
 * `GET /api/risk/:regionId` — a malformed UUID is a generic 400 before
 * any I/O. A well-formed UUID with no `risk_predictions` rows 404s; one
 * that has predictions returns the latest prediction per horizon
 * (`risk_predictions`, queried directly — it isn't one of the read
 * views) joined with the region's latest weather row, which is `null`
 * when no observation exists for that region.
 */
export const riskDetail = new Hono<AppEnv>().get('/:regionId', async (c) => {
  const requestId = c.get('requestId');
  const regionId = c.req.param('regionId');
  if (!regionIdParamSchema.safeParse(regionId).success) {
    return c.json(buildGenericErrorBody(requestId), 400);
  }

  const horizon = parseHorizon(c.req.query('horizon'));
  if (!horizon.ok) {
    return c.json(buildGenericErrorBody(requestId), 400);
  }

  try {
    const supabase = createSupabaseAdmin(c.env);

    const { data: predictionRows, error: predictionError } = await supabase
      .from('risk_predictions')
      .select('*')
      .eq('region_id', regionId)
      .order('horizon_weeks', { ascending: true })
      .order('prediction_date', { ascending: false });

    if (predictionError) {
      logger.error('risk/:regionId: predictions read failed', { requestId });
      return c.json(buildGenericErrorBody(requestId), 503);
    }

    const rows = (predictionRows ?? []) as Record<string, unknown>[];
    // Rows arrive ordered latest-prediction-date-first within each
    // horizon, so the first row seen per horizon is the one to keep.
    const latestByHorizon = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      const horizonWeeks = Number(row.horizon_weeks);
      if (!latestByHorizon.has(horizonWeeks)) {
        latestByHorizon.set(horizonWeeks, row);
      }
    }

    if (latestByHorizon.size === 0) {
      return c.json(buildGenericErrorBody(requestId), 404);
    }

    const { data: regionRows, error: regionError } = await supabase
      .from('regions')
      .select('id, code, name')
      .eq('id', regionId)
      .limit(1);

    if (regionError) {
      logger.error('risk/:regionId: region read failed', { requestId });
      return c.json(buildGenericErrorBody(requestId), 503);
    }

    const regionRow = (regionRows ?? [])[0] as Record<string, unknown> | undefined;

    const { data: weatherRows, error: weatherError } = await supabase
      .from('region_latest_weather')
      .select('*')
      .eq('region_id', regionId)
      .limit(1);

    if (weatherError) {
      logger.error('risk/:regionId: weather read failed', { requestId });
      return c.json(buildGenericErrorBody(requestId), 503);
    }

    const weatherRow = (weatherRows ?? [])[0] as Record<string, unknown> | undefined;

    const { data: verifiedReportsData, error: verifiedReportsError } = await supabase
      .rpc('verified_reports_in_region', { p_region_id: regionId });

    if (verifiedReportsError) {
      logger.error('risk/:regionId: verified_reports_in_region RPC failed', { requestId });
      return c.json(buildGenericErrorBody(requestId), 503);
    }
    
    const verifiedReportsRows = (verifiedReportsData ?? []) as Record<string, unknown>[];
    const verifiedReports = verifiedReportsRows.map(row => ({
      id: String(row.id),
      lat: Number(row.lat),
      lng: Number(row.lng),
      description: row.description ? String(row.description) : null,
      photoUrl: row.photo_url ? String(row.photo_url) : null,
      aiCategory: row.ai_category ? String(row.ai_category) : null,
      createdAt: String(row.created_at),
    }));

    const predictions = Array.from(latestByHorizon.values()).map((row) => {
      const modelVersion = String(row.model_version);
      return {
        horizonWeeks: Number(row.horizon_weeks),
        predictionDate: String(row.prediction_date),
        riskScore: toNumberOrNull(row.risk_score) ?? 0,
        riskLevel: row.risk_level,
        modelVersion,
        isStub: modelVersion === STUB_MODEL_VERSION,
        topFactors: parseTopFactors(row.top_factors),
        generatedAt: toIsoString(row.generated_at),
      };
    });

    const body = riskDetailResponseSchema.parse({
      regionId,
      regionCode: regionRow?.code !== undefined ? String(regionRow.code) : '',
      regionName: regionRow?.name !== undefined ? String(regionRow.name) : '',
      predictions,
      latestWeather: weatherRow ? toWeatherObservationDto(weatherRow) : null,
      verifiedReports,
      requestId,
    });
    return c.json(body, 200);
  } catch (error) {
    logger.error('risk/:regionId: unexpected failure', {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return c.json(buildGenericErrorBody(requestId), 503);
  }
});
