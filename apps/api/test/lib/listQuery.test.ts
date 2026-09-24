import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { listQueryFor } from '@avash/types';
import { parseListQuery, buildPageMeta } from '../../src/lib/listQuery';
import { requestId } from '../../src/middleware/request-id';
import type { AppEnv } from '../../src/types';

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.get('/', (c) => {
    const result = parseListQuery(c, listQueryFor(['createdAt'] as const));
    if (!result.ok) return result.response;
    return c.json({ ok: true, query: result.query });
  });
  return app;
}

describe('parseListQuery', () => {
  test('a well-formed query parses', async () => {
    const app = buildApp();
    const res = await app.request('/?page=2&pageSize=10&sort=createdAt&dir=desc');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: { page: number; pageSize: number } };
    expect(body.query.page).toBe(2);
    expect(body.query.pageSize).toBe(10);
  });

  test('an undeclared sort key 400s', async () => {
    const app = buildApp();
    const res = await app.request('/?sort=email');
    expect(res.status).toBe(400);
  });

  test('a pageSize over the max 400s', async () => {
    const app = buildApp();
    const res = await app.request('/?pageSize=9999');
    expect(res.status).toBe(400);
  });
});

describe('buildPageMeta', () => {
  test('hasNext derives from arithmetic when total is known', () => {
    const meta = buildPageMeta({ page: 1, pageSize: 25, total: 100, returned: 25 });
    expect(meta.hasNext).toBe(true);
    const lastPage = buildPageMeta({ page: 4, pageSize: 25, total: 100, returned: 25 });
    expect(lastPage.hasNext).toBe(false);
  });

  test('hasNext derives from a full page when total is null (decision A)', () => {
    const fullPage = buildPageMeta({ page: 1, pageSize: 50, total: null, returned: 50 });
    expect(fullPage.hasNext).toBe(true);
    const partialPage = buildPageMeta({ page: 2, pageSize: 50, total: null, returned: 10 });
    expect(partialPage.hasNext).toBe(false);
  });
});
