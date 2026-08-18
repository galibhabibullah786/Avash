import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { type AlertSubscribe } from '@avash/types';
import { fetchApi } from '../../lib/apiClient';
import { ALERT_SUBSCRIPTIONS_QUERY_KEY } from './useAlertSubscriptions';

// packages/types/alerts.ts freezes the request shape (`alertSubscribeSchema`)
// but defines no response schema for this route — it upserts a row and
// there is nothing yet in the frozen contract worth asserting about its
// reply. `z.unknown()` keeps fetchApi's zod-validated-response guarantee
// (apiClient.ts) honest without inventing a shape that isn't actually frozen.
const alertSubscribeResponseSchema = z.unknown();

export interface SubscribeAlertInput extends AlertSubscribe {
  accessToken: string;
}

export async function subscribeAlert(input: SubscribeAlertInput): Promise<void> {
  const { accessToken, ...body } = input;
  const result = await fetchApi('/api/alerts/subscribe', alertSubscribeResponseSchema, {
    method: 'POST',
    body,
    accessToken,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
}

/** Refetches the caller's own subscriptions on success so the form reflects the real, persisted state on the next mount/reload. */
export function useSubscribeAlert() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, SubscribeAlertInput>({
    mutationFn: subscribeAlert,
    onSuccess: () => {
      queryClient?.invalidateQueries?.({ queryKey: ALERT_SUBSCRIPTIONS_QUERY_KEY });
    },
  });
}
