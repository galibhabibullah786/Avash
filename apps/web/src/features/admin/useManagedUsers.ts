import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { managedUserSchema, paginatedResponseSchema, type ListQuery } from '@avash/types';
import { fetchApi } from '../../lib/apiClient';

export const MANAGED_USERS_QUERY_KEY = ['admin', 'users'] as const;

/**
 * `GET /api/admin/users` now returns the shared `paginatedResponseSchema`
 * envelope (`{ items, page, requestId }`) rather than the old
 * `{ users, nextPage, requestId }` shape (A-T04's breaking change, met
 * here in the same slice per Appendix A §1/§5). This route cannot filter,
 * sort, or count (baseline fact 3), so `page.total` is always `null` and
 * only `page`/`pageSize` are ever sent.
 */
const managedUsersResponseSchema = paginatedResponseSchema(managedUserSchema);
export type ManagedUsersResponse = z.infer<typeof managedUsersResponseSchema>;

/**
 * Goes through `apps/api`, not Supabase directly — listing users needs the
 * Admin API, which needs the service-role key, which must never reach the
 * browser (R2). This is the one read in `apps/web` that has no
 * direct-from-Supabase alternative.
 */
export async function fetchManagedUsers(
  accessToken: string,
  query: Pick<ListQuery, 'page' | 'pageSize'>
): Promise<ManagedUsersResponse> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  const result = await fetchApi(`/api/admin/users?${params.toString()}`, managedUsersResponseSchema, {
    accessToken,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function useManagedUsers(accessToken: string | null, query: Pick<ListQuery, 'page' | 'pageSize'>) {
  return useQuery<ManagedUsersResponse, Error>({
    queryKey: [...MANAGED_USERS_QUERY_KEY, query.page, query.pageSize],
    queryFn: () => fetchManagedUsers(accessToken as string, query),
    // Never fires without a token — the route 401s, and a signed-out
    // render of this page is already prevented by ProtectedRoute.
    enabled: Boolean(accessToken),
  });
}
