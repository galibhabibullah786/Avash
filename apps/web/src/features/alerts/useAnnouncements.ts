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

export interface AnnouncementsQuery extends Pick<ListQuery, 'page' | 'pageSize'> {
  /** Decision H (docs/PROJECT_PLAN.md §6) — the route is authenticated and takes a caller-supplied point. */
  lat: number;
  lng: number;
}

export const ANNOUNCEMENTS_QUERY_KEY = ['alerts', 'announcements'] as const;

export async function fetchAnnouncements(
  accessToken: string,
  query: AnnouncementsQuery
): Promise<AnnouncementsResponse> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    lat: String(query.lat),
    lng: String(query.lng),
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
 * Never fires without both a token and a resolved point (decision H) —
 * `AnnouncementList.tsx` passes `null` for `query` until `useGeolocation()`
 * has settled, so a signed-in visitor who hasn't granted location yet sees
 * a prompt rather than a doomed request.
 */
export function useAnnouncements(accessToken: string | null, query: AnnouncementsQuery | null) {
  return useQuery<AnnouncementsResponse, Error>({
    queryKey: [...ANNOUNCEMENTS_QUERY_KEY, query?.page, query?.pageSize, query?.lat, query?.lng],
    queryFn: () => fetchAnnouncements(accessToken as string, query as AnnouncementsQuery),
    enabled: Boolean(accessToken) && query !== null,
    placeholderData: keepPreviousData,
  });
}
