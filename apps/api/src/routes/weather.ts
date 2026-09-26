import { Hono } from 'hono';
import { latestWeatherResponseSchema, weatherHistoryResponseSchema } from '@avash/types';
import { buildGenericErrorBody, logger } from '@avash/logger';
import { createSupabaseAdmin } from '../lib/supabaseAdmin';
import { toWeatherObservationDto } from '../lib/weatherDto';
import { toNumberOrNull } from '../lib/numeric';
import type { AppEnv } from '../types';

/** `WEATHER_CACHE_TTL_S` (§14) — edge cache for weather reads. */
const WEATHER_CACHE_TTL_S = 'public, max-age=0, s-maxage=900, stale-while-revalidate=1800';
/** `WEATHER_HISTORY_WINDOW_DAYS` (§14) — dashboard history window; also the `?days=` ceiling. */
const WEATHER_HISTORY_WINDOW_DAYS = 14;

export const weather = new Hono<AppEnv>()
  .get('/latest', async (c) => {
    const requestId = c.get('requestId');
    const regionCode = c.req.query('regionCode');

    try {
      const supabase = createSupabaseAdmin(c.env);
      let query = supabase.from('region_latest_weather').select('*').order('region_name', { ascending: true });
      if (regionCode) {
        query = query.eq('region_code', regionCode);
      }

      const { data, error } = await query;
      if (error) {
        logger.error('weather/latest: Supabase read failed', { requestId });
        return c.json(buildGenericErrorBody(requestId), 503);
      }

      const observations = (data ?? []).map((row) =>
        toWeatherObservationDto(row as Record<string, unknown>)
      );

      const body = latestWeatherResponseSchema.parse({
        observations,
        generatedAt: new Date().toISOString(),
        requestId,
      });
      c.header('Cache-Control', WEATHER_CACHE_TTL_S);
      return c.json(body, 200);
    } catch (error) {
      logger.error('weather/latest: unexpected failure', {
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json(buildGenericErrorBody(requestId), 503);
    }
  })
  .get('/history', async (c) => {
    const requestId = c.get('requestId');
    const regionCode = c.req.query('regionCode');
    if (!regionCode) {
      return c.json(buildGenericErrorBody(requestId), 400);
    }

    // ?days= is a chart-window hint, not a security boundary — any
    // unparseable or out-of-range value silently falls back/clamps
    // rather than 400ing.
    const rawDays = Number(c.req.query('days'));
    const windowDays =
      Number.isFinite(rawDays) && rawDays >= 1
        ? Math.min(Math.trunc(rawDays), WEATHER_HISTORY_WINDOW_DAYS)
        : WEATHER_HISTORY_WINDOW_DAYS;

    try {
      const supabase = createSupabaseAdmin(c.env);
      const { data, error } = await supabase
        .from('region_weather_observations')
        .select('*')
        .eq('region_code', regionCode)
        .order('observed_at', { ascending: false })
        .limit(windowDays);

      if (error) {
        logger.error('weather/history: Supabase read failed', { requestId });
        return c.json(buildGenericErrorBody(requestId), 503);
      }

      // Data was fetched descending to get the latest windowDays rows.
      // Reverse to restore chronological (ascending) order.
      const rows = (data ?? []).reverse() as Record<string, unknown>[];
      const regionName = rows.length > 0 ? String(rows[0]?.region_name ?? regionCode) : regionCode;

      const points = rows.map((row) => ({
        observedAt: String(row.observed_at),
        tempMeanC: toNumberOrNull(row.temp_mean_c),
        humidityPct: toNumberOrNull(row.humidity_pct),
        precipitationMm: toNumberOrNull(row.precipitation_mm),
      }));

      const body = weatherHistoryResponseSchema.parse({
        regionCode,
        regionName,
        windowDays,
        points,
        generatedAt: new Date().toISOString(),
        requestId,
      });
      c.header('Cache-Control', WEATHER_CACHE_TTL_S);
      return c.json(body, 200);
    } catch (error) {
      logger.error('weather/history: unexpected failure', {
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      return c.json(buildGenericErrorBody(requestId), 503);
    }
  });
