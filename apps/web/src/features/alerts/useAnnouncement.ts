import { useQuery } from '@tanstack/react-query';
import { announcementSchema, type Announcement } from '@avash/types';
import { fetchApi } from '../../lib/apiClient';

export const ANNOUNCEMENT_QUERY_KEY = ['alerts', 'announcement'] as const;

/**
 * `GET /api/announcements/:id` — resolves a single announcement
 * independent of the caller's geolocation state or which page of the
 * paginated feed it would otherwise be on. This is what lets a
 * deep-linked push notification (`/dashboard?announcement=<id>`) show
 * real content when geolocation is denied, stale, or the announcement
 * has scrolled off the feed (see `sw.js`'s `notificationclick` handler
 * and `Dashboard.tsx`).
 *
 * A 404 (unknown id, role-mismatched id, or expired — the route
 * deliberately can't tell these apart, see `announcements.ts`) is not
 * surfaced as an error here either: a stale/broken notification link is
 * not worth interrupting the dashboard over, so callers should treat
 * `data === undefined` after settling the same as "nothing to pin."
 */
export async function fetchAnnouncement(accessToken: string, id: string): Promise<Announcement> {
  const result = await fetchApi(`/api/announcements/${id}`, announcementSchema, { accessToken });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * Never fires without both a token and an id — `Dashboard.tsx` passes
 * `null` for `id` when the `?announcement=` search param is absent, so a
 * visitor who arrived normally (not via a notification) never issues
 * this request at all.
 */
export function useAnnouncement(accessToken: string | null, id: string | null) {
  return useQuery<Announcement, Error>({
    queryKey: [...ANNOUNCEMENT_QUERY_KEY, id],
    queryFn: () => fetchAnnouncement(accessToken as string, id as string),
    enabled: Boolean(accessToken) && Boolean(id),
    retry: false,
  });
}
