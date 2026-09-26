import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';
import { auth } from '../../src/middleware/auth';
import { requestId } from '../../src/middleware/request-id';
import type { AppEnv } from '../../src/types';
import { signTestJwt } from '../helpers/fakeJwt';

function buildApp(options?: Parameters<typeof auth>[0]) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.get('/protected', auth(options), (c) => {
    const user = c.get('user');
    return c.json({ userId: user?.id, role: user?.role });
  });
  return app;
}

const env = {
  SUPABASE_JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
} as never;

describe('auth middleware', () => {
  test('no Authorization header → 401', async () => {
    const app = buildApp();
    const res = await app.request('/protected', {}, env);
    expect(res.status).toBe(401);
  });

  test('malformed Authorization header → 401', async () => {
    const app = buildApp();
    const res = await app.request('/protected', { headers: { Authorization: 'garbage' } }, env);
    expect(res.status).toBe(401);
  });

  test('expired token → 401', async () => {
    const app = buildApp();
    const token = await signTestJwt({ expiresInSeconds: -3600 - 120 });
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(401);
  });

  test('token signed with the wrong secret → 401', async () => {
    const app = buildApp();
    const token = await signTestJwt({ secret: 'wrong-secret' });
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(401);
  });

  test('valid token whose role lacks the capability → 403', async () => {
    const app = buildApp({ capability: 'roles:manage' });
    const token = await signTestJwt({ role: 'moderator' });
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(403);
  });

  test('valid token with the capability → handler runs and c.get("user") is populated', async () => {
    const app = buildApp({ capability: 'reports:moderate' });
    const token = await signTestJwt({ role: 'moderator' });
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; role: string };
    expect(body.userId).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.role).toBe('moderator');
  });

  test('admin satisfies a capability it holds only via the admin grant', async () => {
    const app = buildApp({ capability: 'reports:moderate' });
    const token = await signTestJwt({ role: 'admin' });
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
  });

  test('moderator cannot reach an admin capability', async () => {
    const app = buildApp({ capability: 'reports:moderate' });
    const token = await signTestJwt({ role: 'moderator' });
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(403);
  });

  test('moderator cannot reach inventory:write — the roles are disjoint, not ranked', async () => {
    const app = buildApp({ capability: 'inventory:write' });
    const token = await signTestJwt({ role: 'moderator' });
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(403);
  });

  test('no capability requirement, any valid token passes', async () => {
    const app = buildApp();
    const token = await signTestJwt({});
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
  });

  test('verified token with no role claim resolves to citizen, not null', async () => {
    const app = buildApp();
    const token = await signTestJwt({});
    const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } }, env);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe('citizen');
  });

  test('citizen holds no capability at all', async () => {
    const token = await signTestJwt({});
    for (const capability of ['reports:moderate', 'inventory:write', 'roles:manage'] as const) {
      const res = await buildApp({ capability }).request(
        '/protected',
        { headers: { Authorization: `Bearer ${token}` } },
        env
      );
      expect(res.status).toBe(403);
    }
  });

  test('401 and 403 bodies never differ by message, only by status', async () => {
    const noTokenApp = buildApp();
    const wrongRoleApp = buildApp({ capability: 'roles:manage' });
    const token = await signTestJwt({ role: 'moderator' });

    const res401 = await noTokenApp.request('/protected', {}, env);
    const res403 = await wrongRoleApp.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      env
    );

    const body401 = (await res401.json()) as { error: { message: string } };
    const body403 = (await res403.json()) as { error: { message: string } };
    expect(body401.error.message).toBe(body403.error.message);
  });
});
