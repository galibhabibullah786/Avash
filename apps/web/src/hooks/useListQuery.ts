import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listQueryFor, LIST_PAGE_SIZE_MAX, type ListQuery, type SortDirection } from '@avash/types';

export interface UseListQueryResult {
  query: ListQuery;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  /** Sets the sort column directly, replacing whatever direction was active. */
  setSort: (sort: string | undefined, dir?: SortDirection) => void;
  /** Click-a-header behavior: same column flips `asc`⇄`desc`; a new column starts at `asc`. */
  toggleSort: (key: string) => void;
  setQ: (q: string) => void;
}

/**
 * Backs page/pageSize/sort/dir/q with `useSearchParams` (B-T06) so a
 * sorted, filtered table is linkable and the back button works. URL search
 * params are untrusted input (R7): every value is parsed through the
 * per-route `listQueryFor(sortable)` schema and anything malformed falls
 * back to the schema's defaults rather than throwing. `pageSize` is
 * clamped to `LIST_PAGE_SIZE_MAX` first (rather than being rejected
 * outright) so an out-of-range value degrades to "the largest allowed
 * page" instead of silently resetting every other param back to page 1.
 */
export function useListQuery<const F extends readonly string[]>(sortable: F): UseListQueryResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const schema = useMemo(() => listQueryFor(sortable), [sortable]);

  const query = useMemo<ListQuery>(() => {
    const rawPageSize = searchParams?.get?.('pageSize');
    const clampedPageSize = clampPageSize(rawPageSize);

    const raw: Record<string, string | undefined> = {
      page: searchParams?.get?.('page') ?? undefined,
      pageSize: clampedPageSize,
      sort: searchParams?.get?.('sort') ?? undefined,
      dir: searchParams?.get?.('dir') ?? undefined,
      q: searchParams?.get?.('q') ?? undefined,
    };

    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      return parsed.data as ListQuery;
    }
    // Anything else malformed (an unknown sort key, a negative page, a
    // q longer than LIST_SEARCH_MAX_CHARS) falls back to defaults rather
    // than throwing — a bad deep link must render the first page, not a
    // crash.
    return schema.parse({}) as ListQuery;
  }, [searchParams, schema]);

  const updateParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined || value === '') {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        }
        return next;
      });
    },
    [setSearchParams]
  );

  const setPage = useCallback((page: number) => updateParams({ page: String(page) }), [updateParams]);

  const setPageSize = useCallback(
    (pageSize: number) => updateParams({ pageSize: String(pageSize), page: '1' }),
    [updateParams]
  );

  const setSort = useCallback(
    (sort: string | undefined, dir: SortDirection = 'asc') =>
      updateParams({ sort: sort ?? undefined, dir: sort ? dir : undefined, page: '1' }),
    [updateParams]
  );

  const toggleSort = useCallback(
    (key: string) => {
      const nextDir: SortDirection = query.sort === key && query.dir === 'asc' ? 'desc' : 'asc';
      setSort(key, nextDir);
    },
    [query.sort, query.dir, setSort]
  );

  const setQ = useCallback((q: string) => updateParams({ q: q.length > 0 ? q : undefined, page: '1' }), [updateParams]);

  return { query, setPage, setPageSize, setSort, toggleSort, setQ };
}

function clampPageSize(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return undefined;
  }
  const clamped = Math.min(Math.max(Math.trunc(num), 1), LIST_PAGE_SIZE_MAX);
  return String(clamped);
}
