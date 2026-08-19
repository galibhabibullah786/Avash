import type { Announcement, AppRole } from '@avash/types';
import { announcementSchema } from '@avash/types';
import { toNumberOrNull } from './numeric';

/** Mean Earth radius in meters — used for the haversine distance below. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * `announcements.geom` comes back from PostgREST as GeoJSON (the same
 * shape `breeding_reports`/`hospitals`/`alert_subscriptions` use elsewhere
 * in this codebase — see `packages/db/types.ts`'s `GeoJSONPoint`), never a
 * typed client object. Every field is optional-chained (R7): a malformed
 * or unexpected row shape resolves to `null` rather than throwing.
 */
function extractLatLng(geom: unknown): { lat: number; lng: number } | null {
  if (typeof geom !== 'object' || geom === null) {
    return null;
  }
  const coordinates = (geom as { coordinates?: unknown })?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    return null;
  }
  const lng = toNumberOrNull(coordinates[0]);
  const lat = toNumberOrNull(coordinates[1]);
  if (lat === null || lng === null) {
    return null;
  }
  return { lat, lng };
}

/**
 * Great-circle distance in meters. No `ST_DWithin` RPC exists for this
 * table (decision B's read-time filter, but without a live PostGIS
 * function to call — `blood_within_radius()` is the only such RPC this
 * codebase defines, and adding a new one is a migration change outside
 * this route's fence), so the radius check runs here instead, against the
 * caller-supplied point and the announcement's own `radius_m`.
 */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Live-row filters (decision B): `expires_at > now()` is applied by the
 * caller's query itself; this covers the two predicates a query alone
 * cannot express — role targeting and proximity.
 */
export function announcementVisibleTo(
  row: Record<string, unknown>,
  callerRole: AppRole,
  callerLat: number,
  callerLng: number
): boolean {
  const targetRoles = Array.isArray(row.target_roles) ? (row.target_roles as unknown[]) : [];
  const roleMatches = targetRoles.length === 0 || targetRoles.includes(callerRole);
  if (!roleMatches) {
    return false;
  }

  const point = extractLatLng(row.geom);
  const radiusM = toNumberOrNull(row.radius_m);
  if (!point || radiusM === null) {
    return false;
  }
  return haversineDistanceMeters(callerLat, callerLng, point.lat, point.lng) <= radiusM;
}

/**
 * Maps an `announcements` row to the frozen `announcementSchema` shape.
 * `lat`/`lng` are read back from the row's `geom`, never re-derived from
 * caller input — the response describes what is actually stored.
 */
export function toAnnouncementDto(row: Record<string, unknown>): Announcement | null {
  const point = extractLatLng(row.geom);
  if (!point) {
    return null;
  }
  const parsed = announcementSchema.safeParse({
    id: row.id,
    authorId: row.author_id ?? null,
    title: row.title,
    body: row.body,
    lat: point.lat,
    lng: point.lng,
    radiusM: toNumberOrNull(row.radius_m),
    targetRoles: Array.isArray(row.target_roles) ? row.target_roles : [],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
  return parsed.success ? parsed.data : null;
}
