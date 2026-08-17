import { useQuery } from '@tanstack/react-query';
import { aiValidationSchema, type AiValidation, type PageMeta, type SortDirection } from '@avash/types';
import { supabase } from '../../lib/supabaseClient';

export interface PendingReportRow {
  id: string;
  description: string | null;
  photo_url: string | null;
  ai_validation: AiValidation | null;
  status: string;
  created_at: string;
}

export type ModerationStatus = 'pending' | 'verified' | 'rejected' | 'resolved';
export type ModerationSortKey = 'createdAt' | 'status';

export interface PendingReportsQuery {
  page: number;
  pageSize: number;
  sort?: ModerationSortKey;
  dir: SortDirection;
  status: ModerationStatus;
}

export interface PendingReportsResult {
  items: PendingReportRow[];
  page: PageMeta;
}

/** Maps the closed sort enum (decision B) to the real column PostgREST orders by. */
const SORT_COLUMN: Record<ModerationSortKey, string> = {
  createdAt: 'created_at',
  status: 'status',
};

/**
 * Reads the moderation queue directly from Supabase (design decision, see
 * docs/features/breeding-reports.md) rather than through `apps/api` — the
 * `breeding_reports_select_moderation` RLS policy already in the frozen
 * migration is what makes this safe: only a signed-in moderator/admin's
 * session can see pending rows here, the same anon-key + session pattern
 * other public-read features use.
 *
 * This is the PostgREST pagination transport (baseline fact 2): `.range()`
 * plus `{ count: 'exact' }` map into the same `PageMeta` shape the Hono
 * transport produces, so `DataTable` cannot tell the two apart. `count` is
 * nullable — a `hasNext` guess from a full page stands in when it is
 * (R7).
 */
export async function fetchPendingReports(query: PendingReportsQuery): Promise<PendingReportsResult> {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  const column = query.sort ? SORT_COLUMN[query.sort] : 'created_at';

  const { data, error, count } = await supabase
    .from('breeding_reports')
    .select('id, description, photo_url, ai_validation, status, created_at', { count: 'exact' })
    .eq('status', query.status)
    .order(column, { ascending: query.dir !== 'desc' })
    .range(from, to);

  if (error) {
    throw new Error('Unable to load the moderation queue.');
  }

  // `ai_validation` is untrusted JSON straight from the DB (not routed
  // through apps/api's zod-validated responses) — a malformed or
  // legacy-shaped blob must never be trusted as the frozen AiValidation
  // shape, so it's re-validated here and dropped to null on mismatch
  // rather than cast.
  const items = (data ?? []).map((row) => {
    const parsed = aiValidationSchema.safeParse(row?.ai_validation);
    return {
      id: row.id,
      description: row.description,
      photo_url: row.photo_url,
      status: row.status,
      created_at: row.created_at,
      ai_validation: parsed.success ? parsed.data : null,
    };
  });

  const total = count ?? null;
  const hasNext = total !== null ? from + items.length < total : items.length === query.pageSize;

  return {
    items,
    page: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasNext,
      sort: query.sort ?? null,
      dir: query.dir,
    },
  };
}

export function usePendingReports(query: PendingReportsQuery) {
  return useQuery<PendingReportsResult, Error>({
    queryKey: ['reports', 'moderation-queue', query.page, query.pageSize, query.sort, query.dir, query.status],
    queryFn: () => fetchPendingReports(query),
  });
}
