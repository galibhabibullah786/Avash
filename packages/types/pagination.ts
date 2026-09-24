import { z } from 'zod';

/** `LIST_PAGE_SIZE_DEFAULT` (§14) — page size when ?pageSize= is absent. */
export const LIST_PAGE_SIZE_DEFAULT = 25;
/** `LIST_PAGE_SIZE_MAX` (§14) — ceiling on any client-requested page size. */
export const LIST_PAGE_SIZE_MAX = 100;
/** `LIST_SEARCH_MAX_CHARS` (§14) — bounds the ?q= filter term. */
export const LIST_SEARCH_MAX_CHARS = 120;

export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

/**
 * The base list query. `sort` is deliberately absent here — a route without
 * a declared sortable set must not accept one. Use listQueryFor().
 */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIST_PAGE_SIZE_MAX).default(LIST_PAGE_SIZE_DEFAULT),
  dir: sortDirectionSchema.default('asc'),
  q: z.string().trim().max(LIST_SEARCH_MAX_CHARS).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema> & { sort?: string };

/**
 * Per-route query schema with a CLOSED sort enum (decision B). A free-string
 * sort key reaching .order() or ORDER BY is an injection and an ordering
 * information-disclosure surface; rejecting at the zod boundary means the
 * handler never sees an unknown key. Pass [] for a source that cannot sort.
 */
export function listQueryFor<const F extends readonly string[]>(sortable: F) {
  return sortable.length === 0
    ? listQuerySchema.extend({ sort: z.never().optional() })
    : listQuerySchema.extend({
        sort: z.enum(sortable as unknown as [string, ...string[]]).optional(),
      });
}

/**
 * `total` is nullable by design (decision A): the Supabase Admin API cannot
 * count, and a contract that demands a total forces either a fabricated
 * number or a route that cannot use this shape. `hasNext` is the signal
 * every consumer can rely on.
 */
export const pageMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0).nullable(),
  hasNext: z.boolean(),
  sort: z.string().nullable(),
  dir: sortDirectionSchema,
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

export function paginatedResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item), // [] is valid, never null
    page: pageMetaSchema,
    requestId: z.string(),
  });
}
