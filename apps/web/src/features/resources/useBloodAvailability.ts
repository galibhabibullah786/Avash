import { useQuery } from '@tanstack/react-query';
import { bloodSearchResponseSchema, type BloodSearchResponse, type BloodGroup } from '@avash/types';
import { fetchApi } from '../../lib/apiClient';

export interface BloodSearchParams {
  bloodGroup: BloodGroup;
  lat?: number;
  lng?: number;
}

/** Exported separately so the query logic is testable without rendering a component tree. */
export async function fetchBloodAvailability(params: BloodSearchParams): Promise<BloodSearchResponse> {
  const query = new URLSearchParams({
    bloodGroup: params.bloodGroup,
  });
  if (typeof params.lat === 'number' && typeof params.lng === 'number') {
    query.set('lat', String(params.lat));
    query.set('lng', String(params.lng));
  }
  const result = await fetchApi(`/api/resources/blood?${query.toString()}`, bloodSearchResponseSchema);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function useBloodAvailability(params: BloodSearchParams) {
  return useQuery<BloodSearchResponse, Error>({
    queryKey: ['resources', 'blood', params.bloodGroup, params.lat ?? null, params.lng ?? null],
    queryFn: () => fetchBloodAvailability(params),
  });
}
