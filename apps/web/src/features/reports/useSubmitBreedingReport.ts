import { useMutation } from '@tanstack/react-query';
import { breedingReportResponseSchema, type BreedingReportResponse } from '@avash/types';
import { fetchApi } from '../../lib/apiClient';

export interface SubmitBreedingReportInput {
  lat: number;
  lng: number;
  description?: string;
  photoUrl?: string;
  turnstileToken: string;
  /** Attached only when the submitter is signed in; the route works fully anonymously without it. */
  accessToken?: string | null;
}

export async function submitBreedingReport(input: SubmitBreedingReportInput): Promise<BreedingReportResponse> {
  const { accessToken, ...body } = input;
  const result = await fetchApi('/api/reports/breeding-site', breedingReportResponseSchema, {
    method: 'POST',
    body,
    ...(accessToken ? { accessToken } : {}),
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function useSubmitBreedingReport() {
  return useMutation<BreedingReportResponse, Error, SubmitBreedingReportInput>({
    mutationFn: submitBreedingReport,
  });
}
