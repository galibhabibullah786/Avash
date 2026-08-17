import { describe, test, expect, vi, afterEach } from 'vitest';
import { createAuditSink } from '../../src/lib/auditSink';
import { createSupabaseAdmin } from '../../src/lib/supabaseAdmin';
import { createFakeSupabase, postgrestErrorBody } from '../helpers/fakeSupabase';
import type { Bindings } from '../../src/types';

function fakeBindings(): Bindings {
  return {
    SUPABASE_URL: 'https://project.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
    GEMINI_API_KEY: '',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    TURNSTILE_SECRET_KEY: '',
    ENVIRONMENT: 'test',
    CORS_ALLOWED_ORIGINS: 'https://avash.pages.dev',
    CORS_PREVIEW_ORIGIN_SUFFIX: 'avash.pages.dev',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
  };
}

describe('createAuditSink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('inserts the row into audit_log and returns no error on success', async () => {
    const fake = createFakeSupabase([{ path: '/rest/v1/audit_log', body: [{ id: 1 }] }]);
    const supabase = createSupabaseAdmin(fakeBindings(), { fetch: fake.fetch });
    const sink = createAuditSink(supabase);

    const row = { action: 'role.assign', entity_type: 'user' };
    const { error } = await sink.insert(row);

    expect(error).toBeNull();
    expect(fake.calls.some((url) => url.pathname === '/rest/v1/audit_log')).toBe(true);
  });

  test('surfaces a PostgREST error rather than throwing', async () => {
    const fake = createFakeSupabase([
      { path: '/rest/v1/audit_log', body: postgrestErrorBody(), status: 500 },
    ]);
    const supabase = createSupabaseAdmin(fakeBindings(), { fetch: fake.fetch });
    const sink = createAuditSink(supabase);

    const { error } = await sink.insert({ action: 'role.assign' });
    expect(error).not.toBeNull();
  });
});
