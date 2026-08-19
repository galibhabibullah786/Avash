import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/env', () => ({
  env: {
    apiBaseUrl: 'https://api.example.test',
    supabaseUrl: 'https://project.supabase.test',
    supabaseAnonKey: 'anon-key',
    turnstileSiteKey: 'turnstile-key',
  },
}));

let limitResult: { data: unknown; error: unknown } = { data: [], error: null };
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

/**
 * The shape PostgREST actually returns for a `geometry(Point, 4326)`
 * column: PostGIS's geometry -> json cast emits GeoJSON, so this is a
 * parsed object, never WKB hex. `ml/serving/push_delivery.py` decodes the
 * same shape server-side.
 */
function geojsonPoint(lng: number, lat: number) {
  return { type: 'Point', crs: { type: 'name', properties: { name: 'EPSG:4326' } }, coordinates: [lng, lat] };
}

describe('fetchAlertSubscription', () => {
  beforeEach(() => {
    vi.resetModules();
    limitResult = { data: [], error: null };
    const limit = vi.fn(async () => limitResult);
    selectMock.mockReset();
    selectMock.mockImplementation(() => ({ limit }));
    fromMock.mockReset();
    fromMock.mockImplementation(() => ({ select: selectMock }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reads the caller\'s own row from alert_subscriptions', async () => {
    const { fetchAlertSubscription } = await import('./useAlertSubscription');
    await fetchAlertSubscription();

    expect(fromMock).toHaveBeenCalledWith('alert_subscriptions');
    // RLS scopes the row to auth.uid(), so no user_id filter belongs here.
    expect(selectMock).toHaveBeenCalledWith('id, radius_m, active, geom');
  });

  test('maps a row to the DTO, decoding geom as GeoJSON (lng first, lat second)', async () => {
    limitResult = {
      data: [{ id: 'sub-1', radius_m: 3500, active: true, geom: geojsonPoint(90.4, 23.8) }],
      error: null,
    };
    const { fetchAlertSubscription } = await import('./useAlertSubscription');

    expect(await fetchAlertSubscription()).toEqual({
      id: 'sub-1',
      radiusM: 3500,
      active: true,
      lat: 23.8,
      lng: 90.4,
    });
  });

  test('resolves to null when the user has no subscription', async () => {
    limitResult = { data: [], error: null };
    const { fetchAlertSubscription } = await import('./useAlertSubscription');
    expect(await fetchAlertSubscription()).toBeNull();
  });

  test('an INACTIVE row is still returned — it occupies the user\'s one slot, so hiding it would misreport their state', async () => {
    limitResult = {
      data: [{ id: 'sub-1', radius_m: 2000, active: false, geom: geojsonPoint(90.4, 23.8) }],
      error: null,
    };
    const { fetchAlertSubscription } = await import('./useAlertSubscription');
    expect(await fetchAlertSubscription()).toMatchObject({ id: 'sub-1', active: false });
  });

  test('an unreadable geom degrades to a null point rather than throwing away the whole row', async () => {
    limitResult = { data: [{ id: 'sub-1', radius_m: 2000, active: true, geom: 'not-geojson' }], error: null };
    const { fetchAlertSubscription } = await import('./useAlertSubscription');
    expect(await fetchAlertSubscription()).toEqual({
      id: 'sub-1',
      radiusM: 2000,
      active: true,
      lat: null,
      lng: null,
    });
  });

  test('a Supabase error surfaces a generic message, never the raw PostgREST text', async () => {
    limitResult = { data: null, error: { message: 'permission denied for table alert_subscriptions' } };
    const { fetchAlertSubscription } = await import('./useAlertSubscription');
    await expect(fetchAlertSubscription()).rejects.toThrow('Unable to load your alert subscription right now.');
  });

  test('a null data payload with no error resolves to null rather than throwing', async () => {
    limitResult = { data: null, error: null };
    const { fetchAlertSubscription } = await import('./useAlertSubscription');
    expect(await fetchAlertSubscription()).toBeNull();
  });
});
