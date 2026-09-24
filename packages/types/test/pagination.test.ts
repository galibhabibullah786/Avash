import { describe, test, expect } from 'vitest';
import {
  listQuerySchema,
  listQueryFor,
  LIST_PAGE_SIZE_DEFAULT,
  LIST_PAGE_SIZE_MAX,
} from '../pagination';

describe('listQuerySchema — defaults', () => {
  test('an empty query yields the documented defaults', () => {
    const parsed = listQuerySchema.parse({});
    expect(parsed).toEqual({
      page: 1,
      pageSize: LIST_PAGE_SIZE_DEFAULT,
      dir: 'asc',
      q: undefined,
    });
  });

  test('pageSize over LIST_PAGE_SIZE_MAX fails', () => {
    const result = listQuerySchema.safeParse({ pageSize: LIST_PAGE_SIZE_MAX + 1 });
    expect(result.success).toBe(false);
  });
});

describe('listQueryFor — closed sort enum (decision B)', () => {
  test('an empty sortable set rejects any sort key', () => {
    const result = listQueryFor([]).safeParse({ sort: 'x' });
    expect(result.success).toBe(false);
  });

  test('a declared sortable column parses', () => {
    const result = listQueryFor(['createdAt']).parse({ sort: 'createdAt' });
    expect(result.sort).toBe('createdAt');
  });

  test('an undeclared sort key is rejected', () => {
    const result = listQueryFor(['createdAt']).safeParse({ sort: 'email' });
    expect(result.success).toBe(false);
  });
});
