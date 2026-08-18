import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchApi } from '../../lib/apiClient';
import { ALERT_SUBSCRIPTION_QUERY_KEY } from './useAlertSubscription';

// Mirrors the subscribe hook: the route replies `{ id, requestId }` but
// nothing in that reply is worth asserting a shape for here — the form
// re-reads the real row from Supabase on success instead of trusting the
// mutation's own return value.
const alertUnsubscribeResponseSchema = z.unknown();

export async function unsubscribeAlert(accessToken: string): Promise<void> {
  const result = await fetchApi('/api/alerts/subscribe', alertUnsubscribeResponseSchema, {
    method: 'DELETE',
    accessToken,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
}

/**
 * Removes the caller's one proximity-alert subscription. The row is
 * identified server-side from the JWT, so nothing identifying a row is
 * sent — see the DELETE handler in `apps/api/src/routes/alerts.ts`.
 */
export function useUnsubscribeAlert() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: unsubscribeAlert,
    onSuccess: () => {
      queryClient?.invalidateQueries?.({ queryKey: ALERT_SUBSCRIPTION_QUERY_KEY });
    },
  });
}
