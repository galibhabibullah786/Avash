import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { announcementSchema, paginatedResponseSchema, type ListQuery } from '@avash/types';
import { fetchApi } from '../../lib/apiClient';

/**
 * `GET /api/announcements` returns the shared paginated envelope
 * (`{ items, page, requestId }`, packages/types/pagination.ts) wrapping
 * the frozen `announcementSchema` — the same pattern
 * `useManagedUsers.ts` uses for a route whose response shape isn't
 * itself declared in `packages/types`.
 */
const announcementsResponseSchema = paginatedResponseSchema(announcementSchema);
export type AnnouncementsResponse = z.infer<typeof announcementsResponseSchema>;

/**
 * A discriminated union rather than one shape with optional fields,
 * because the two scopes take genuinely different inputs: `nearby` is
 * meaningless without a point (decision H, docs/PROJECT_PLAN.md §6 — the
 * route is authenticated and takes a caller-supplied point), and `manage`
 * ignores one entirely. Optional lat/lng would let a nearby query compile
 * with no point and fail at runtime with a 400.
 */
export type AnnouncementsQuery = Pick<ListQuery, 'page' | 'pageSize'> &
  ({ scope?: 'nearby'; lat: number; lng: number } | { scope: 'manage' });

export const ANNOUNCEMENTS_QUERY_KEY = ['alerts', 'announcements'] as const;

export async function fetchAnnouncements(
  accessToken: string,
  query: AnnouncementsQuery
): Promise<AnnouncementsResponse> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    ...(query.scope === 'manage'
      ? { scope: 'manage' }
      : { lat: String(query.lat), lng: String(query.lng) }),
  });
  const result = await fetchApi(`/api/announcements?${params.toString()}`, announcementsResponseSchema, {
    accessToken,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * Never fires without a token, and — in the `nearby` scope — without a
 * resolved point either (decision H): `AnnouncementList.tsx` passes `null`
 * for `query` until `useGeolocation()` has settled, so a signed-in visitor
 * who hasn't granted location yet sees a prompt rather than a doomed
 * request. The `manage` scope has no such gate, since it takes no point.
 */
export function useAnnouncements(accessToken: string | null, query: AnnouncementsQuery | null) {
  const scope = query?.scope ?? 'nearby';
  const point = query && query.scope !== 'manage' ? query : null;
  return useQuery<AnnouncementsResponse, Error>({
    queryKey: [...ANNOUNCEMENTS_QUERY_KEY, scope, query?.page, query?.pageSize, point?.lat, point?.lng],
    queryFn: () => fetchAnnouncements(accessToken as string, query as AnnouncementsQuery),
    enabled: Boolean(accessToken) && query !== null,
    placeholderData: keepPreviousData,
  });
}
