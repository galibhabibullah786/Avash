import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../../lib/apiClient';
import { z } from 'zod';


export const reportSubmissionListResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    description: z.string().nullable(),
    photoUrl: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
    status: z.string(),
    createdAt: z.string(),
    distance: z.number()
  })),
  requestId: z.string(),
});

export function useReportSubmissions(
  accessToken: string | null,
  query: { lat: number; lng: number } | null
) {
  return useQuery({
    queryKey: ['report-submissions', query?.lat, query?.lng],
    queryFn: async () => {
      if (!query) throw new Error('Missing query');
      const search = new URLSearchParams({
        lat: String(query.lat),
        lng: String(query.lng)
      });
      const result = await fetchApi(
        `/api/reports?${search.toString()}`,
        reportSubmissionListResponseSchema,
        { accessToken: accessToken || undefined }
      );
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: Boolean(accessToken && query),
    staleTime: 60 * 1000,
  });
}
