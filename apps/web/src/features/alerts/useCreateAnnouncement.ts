import { useMutation, useQueryClient } from '@tanstack/react-query';
import { announcementSchema, type AnnouncementCreate, type Announcement } from '@avash/types';
import { fetchApi } from '../../lib/apiClient';
import { ANNOUNCEMENTS_QUERY_KEY } from './useAnnouncements';

export interface CreateAnnouncementInput extends AnnouncementCreate {
  accessToken: string;
}

/**
 * `POST /api/announcements` creates a row and, by REST convention, hands
 * the created row back — `announcementSchema` already extends
 * `announcementCreateSchema` with the server-assigned `id`/`authorId`/
 * `createdAt` for exactly this purpose.
 */
export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  const { accessToken, ...body } = input;
  const result = await fetchApi('/api/announcements', announcementSchema, {
    method: 'POST',
    body,
    accessToken,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

/** Refetches the list on success so a moderator's new announcement shows up without a manual reload. */
export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation<Announcement, Error, CreateAnnouncementInput>({
    mutationFn: createAnnouncement,
    onSuccess: () => {
      queryClient?.invalidateQueries?.({ queryKey: ANNOUNCEMENTS_QUERY_KEY });
    },
  });
}
