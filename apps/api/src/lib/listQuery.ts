import type { Context } from 'hono';
import type { z } from 'zod';
import { buildGenericErrorBody } from '@avash/logger';
import type { PageMeta, SortDirection } from '@avash/types';
import type { AppEnv } from '../types';

export type ParseListQueryResult<T> = { ok: true; query: T } | { ok: false; response: Response };

/**
 * Reads page/pageSize/sort/dir/q off the Hono context's query string and
 * validates them against the route's `listQueryFor(...)` schema. Search
 * params are untrusted (R7) — a malformed value never throws here, it
 * fails the zod parse and the caller returns the generic 400.
 */
export function parseListQuery<S extends z.ZodTypeAny>(
  c: Context<AppEnv>,
  schema: S
): ParseListQueryResult<z.infer<S>> {
  const raw = {
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    sort: c.req.query('sort'),
    dir: c.req.query('dir'),
    q: c.req.query('q'),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: c.json(buildGenericErrorBody(c.get('requestId')), 400) };
  }
  return { ok: true, query: parsed.data };
}

export interface BuildPageMetaOptions {
  page: number;
  pageSize: number;
  /** `null` when the source cannot count (decision A) — e.g. the Admin API. */
  total: number | null;
  /** Row count actually returned for this page — drives `hasNext` when `total` is null. */
  returned: number;
  sort?: string | null;
  dir?: SortDirection;
}

/**
 * `hasNext` is the signal every consumer relies on regardless of whether
 * `total` is known: with a total, it's arithmetic; without one, a full
 * page came back means there may be more (decision A).
 */
export function buildPageMeta(options: BuildPageMetaOptions): PageMeta {
  const hasNext =
    options.total !== null
      ? options.page * options.pageSize < options.total
      : options.returned >= options.pageSize;
  return {
    page: options.page,
    pageSize: options.pageSize,
    total: options.total,
    hasNext,
    sort: options.sort ?? null,
    dir: options.dir ?? 'asc',
  };
}
