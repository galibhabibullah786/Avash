import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';

export interface AlertSubscriptionRow {
  id: string;
  radiusM: number;
  active: boolean;
}

export const ALERT_SUBSCRIPTIONS_QUERY_KEY = ['alerts', 'subscriptions'] as const;

/**
 * Reads the caller's own `alert_subscriptions` rows directly against
 * Supabase — the same direct-to-Supabase pattern
 * `useBloodInventoryRealtime.ts` uses for a different table, rather than
 * a new `apps/api` route. RLS (`alert_subscriptions_owner_all`) already
 * scopes every row to `user_id = auth.uid()`, and there is no
 * `GET /api/alerts/subscribe` in the frozen contract — POST is
 * upsert-only. This is what lets the form show real subscribed state
 * instead of only the current session's ephemeral mutation result, which
 * reverts to "not subscribed" on every page reload even though the row
 * is still there.
 */
export async function fetchAlertSubscriptions(): Promise<AlertSubscriptionRow[]> {
  const { data, error } = await supabase
    ?.from('alert_subscriptions')
    ?.select('id, radius_m, active')
    ?.eq('active', true);
  if (error) {
    throw new Error('Unable to load your alert subscriptions right now.');
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: typeof row?.id === 'string' ? row.id : '',
    radiusM: typeof row?.radius_m === 'number' ? row.radius_m : 0,
    active: Boolean(row?.active),
  }));
}

export function useAlertSubscriptions(userId: string | null) {
  return useQuery<AlertSubscriptionRow[], Error>({
    queryKey: [...ALERT_SUBSCRIPTIONS_QUERY_KEY, userId],
    queryFn: fetchAlertSubscriptions,
    enabled: Boolean(userId),
  });
}
