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
      const search = new URLSearchParams();
      if (query) {
        search.set('lat', String(query.lat));
        search.set('lng', String(query.lng));
      }
      const qs = search.toString();
      const endpoint = qs ? `/api/reports?${qs}` : '/api/reports';
      const result = await fetchApi(
        endpoint,
        reportSubmissionListResponseSchema,
        { accessToken: accessToken || undefined }
      );
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: true,
    staleTime: 60 * 1000,
  });
}
