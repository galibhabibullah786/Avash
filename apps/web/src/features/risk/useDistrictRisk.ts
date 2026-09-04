import { useQuery } from '@tanstack/react-query';
import {
  riskSummaryRecordSchema,
  type RiskSummaryRecord,
} from '@avash/types';
import { fetchApi } from '../../lib/apiClient';

export async function fetchDistrictRisk(district: string): Promise<RiskSummaryRecord> {
  const params = new URLSearchParams({ district });
  const result = await fetchApi(
    `/api/risk-map?${params.toString()}`,
    riskSummaryRecordSchema,
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function useDistrictRisk(district: string | null) {
  return useQuery<RiskSummaryRecord, Error>({
    queryKey: ['risk', 'district', district],
    enabled: Boolean(district),
    queryFn: () => fetchDistrictRisk(district ?? ''),
  });
}
