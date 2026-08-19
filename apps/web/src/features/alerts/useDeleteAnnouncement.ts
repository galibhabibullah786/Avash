import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchApi } from '../../lib/apiClient';
import { ANNOUNCEMENTS_QUERY_KEY } from './useAnnouncements';

// `DELETE /api/announcements/:id` replies 204 with no body, which
// `fetchApi` hands to the schema as null after its `.json()` attempt
// fails. `z.unknown()` accepts that without inventing a response shape
// the route does not actually return.
const announcementDeleteResponseSchema = z.unknown();

export interface DeleteAnnouncementInput {
  id: string;
  accessToken: string;
}

export async function deleteAnnouncement(input: DeleteAnnouncementInput): Promise<void> {
  const result = await fetchApi(`/api/announcements/${encodeURIComponent(input.id)}`, announcementDeleteResponseSchema, {
    method: 'DELETE',
    accessToken: input.accessToken,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
}

/**
 * Author-or-admin deletion. The route enforces that itself — the
 * management list only offers the button for rows the same rule already
 * returned, so the two never disagree, but the client-side side of it is
 * an affordance, not the boundary.
 *
 * Invalidates the whole announcements key rather than just the manage
 * scope: a deleted row must also disappear from the nearby feed.
 */
export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, DeleteAnnouncementInput>({
    mutationFn: deleteAnnouncement,
    onSuccess: () => {
      queryClient?.invalidateQueries?.({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
    },
  });
}
