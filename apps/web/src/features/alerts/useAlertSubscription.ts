import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';

export interface AlertSubscriptionRow {
  id: string;
  radiusM: number;
  active: boolean;
  /** The geofence centre, or null when the stored geometry is unreadable. */
  lat: number | null;
  lng: number | null;
}

export const ALERT_SUBSCRIPTION_QUERY_KEY = ['alerts', 'subscription'] as const;

/**
 * The caller's `geom` as PostgREST returns it: PostGIS's `geometry -> json`
 * cast emits GeoJSON, so a plain select over the column yields a parsed
 * `{ type: 'Point', coordinates: [lon, lat] }` object — never WKB hex.
 * (`ml/serving/push_delivery.py`'s `decode_point_geojson` decodes the same
 * shape server-side.) Anything else degrades to a null point rather than
 * throwing, so an odd row still renders as "subscribed" with its radius.
 */
function readPoint(geom: unknown): { lat: number | null; lng: number | null } {
  const coordinates = (geom as { coordinates?: unknown })?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    return { lat: null, lng: null };
  }
  const [lng, lat] = coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { lat: null, lng: null };
  }
  return { lat, lng };
}

/**
 * Reads the caller's own `alert_subscriptions` row directly against
 * Supabase — the same direct-to-Supabase pattern
 * `useBloodInventoryRealtime.ts` uses for a different table, rather than
 * a new `apps/api` route. RLS (`alert_subscriptions_owner_all`) already
 * scopes every row to `user_id = auth.uid()`, and there is no
 * `GET /api/alerts/subscribe` in the contract — POST is upsert-only.
 * This is what lets the form show real subscribed state instead of only
 * the current session's ephemeral mutation result, which reverts to "not
 * subscribed" on every page reload even though the row is still there.
 *
 * At most one row exists per user (`alert_subscriptions_user_id_key`), so
 * this resolves to a single subscription or null. `active` is NOT filtered
 * on here — an inactive row still occupies the user's one slot, and
 * hiding it would show "not subscribed" for a user whose next subscribe
 * would silently update a row they cannot see.
 */
export async function fetchAlertSubscription(): Promise<AlertSubscriptionRow | null> {
  const { data, error } = await supabase
    ?.from('alert_subscriptions')
    ?.select('id, radius_m, active, geom')
    ?.limit(1);
  if (error) {
    throw new Error('Unable to load your alert subscription right now.');
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  const { lat, lng } = readPoint(row?.geom);
  return {
    id: typeof row?.id === 'string' ? row.id : '',
    radiusM: typeof row?.radius_m === 'number' ? row.radius_m : 0,
    active: Boolean(row?.active),
    lat,
    lng,
  };
}

export function useAlertSubscription(userId: string | null) {
  return useQuery<AlertSubscriptionRow | null, Error>({
    queryKey: [...ALERT_SUBSCRIPTION_QUERY_KEY, userId],
    queryFn: fetchAlertSubscription,
    enabled: Boolean(userId),
  });
}
