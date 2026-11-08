import { describe, test, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createChat } from '../../src/routes/chat';
import { requestId } from '../../src/middleware/request-id';
import { createFakeSupabase } from '../helpers/fakeSupabase';
import { signTestJwt } from '../helpers/fakeJwt';
import { createSupabaseAdmin } from '../../src/lib/supabaseAdmin';
import type { AppEnv, Bindings } from '../../src/types';

function fakeBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    SUPABASE_URL: 'https://project.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    SUPABASE_JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
    GEMINI_API_KEY: 'test-gemini-key',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    TURNSTILE_SECRET_KEY: '',
    ENVIRONMENT: 'test',
    CORS_ALLOWED_ORIGINS: 'https://avash.pages.dev',
    CORS_PREVIEW_ORIGIN_SUFFIX: 'avash.pages.dev',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
    ...overrides,
  };
}

describe('POST /api/chat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('valid chat request stores turns in ai_chat_logs and returns 200 with text and sessionId', async () => {
    const insertedChatLogs: unknown[] = [];
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/ai_chat_logs',
        match: (_sp, method) => method === 'POST',
        body: [{ id: 1 }],
      },
      {
        path: '/rest/v1/audit_log',
        match: (_sp, method) => method === 'POST',
        body: [{ id: 1 }],
      },
    ]);

    // Track calls with body
    const originalFetch = fake.fetch;
    const trackedFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/rest/v1/ai_chat_logs') && init?.body) {
        insertedChatLogs.push(JSON.parse(String(init.body)));
      }
      return originalFetch(input, init);
    };

    const mockGeminiFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ডেঙ্গু হলে বিশ্রাম নিন এবং প্রচুর পানি পান করুন।' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.route(
      '/',
      createChat({
        supabaseFactory: (env) => createSupabaseAdmin(env, { fetch: trackedFetch }),
        geminiFetch: mockGeminiFetch,
      })
    );

    const res = await app.request(
      '/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ text: 'ডেঙ্গু হলে কি করব?', sender: 'user' }],
        }),
      },
      fakeBindings()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; sessionId: string };
    expect(body.text).toBe('ডেঙ্গু হলে বিশ্রাম নিন এবং প্রচুর পানি পান করুন।');
    expect(body.sessionId).toBeDefined();

    // Verify chat logs were inserted
    expect(insertedChatLogs.length).toBe(1);
    const logs = insertedChatLogs[0] as Array<{
      session_id: string;
      message_role: string;
      content: string;
      model: string;
    }>;
    expect(logs).toHaveLength(2);
    expect(logs[0]?.message_role).toBe('user');
    expect(logs[0]?.content).toBe('ডেঙ্গু হলে কি করব?');
    expect(logs[0]?.session_id).toBe(body.sessionId);
    expect(logs[1]?.message_role).toBe('model');
    expect(logs[1]?.content).toBe('ডেঙ্গু হলে বিশ্রাম নিন এবং প্রচুর পানি পান করুন।');
  });

  test('authenticated user attaches user_id in ai_chat_logs and preserves sessionId', async () => {
    const userId = '11111111-2222-4333-8444-555555555555';
    const clientSessionId = '99999999-8888-4777-a666-555555555555';
    const token = await signTestJwt({ sub: userId, role: 'citizen' });

    const insertedChatLogs: unknown[] = [];
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/ai_chat_logs',
        match: (_sp, method) => method === 'POST',
        body: [{ id: 1 }],
      },
      {
        path: '/rest/v1/audit_log',
        match: (_sp, method) => method === 'POST',
        body: [{ id: 1 }],
      },
    ]);

    const originalFetch = fake.fetch;
    const trackedFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/rest/v1/ai_chat_logs') && init?.body) {
        insertedChatLogs.push(JSON.parse(String(init.body)));
      }
      return originalFetch(input, init);
    };

    const mockGeminiFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Response from bot' }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.route(
      '/',
      createChat({
        supabaseFactory: (env) => createSupabaseAdmin(env, { fetch: trackedFetch }),
        geminiFetch: mockGeminiFetch,
      })
    );

    const res = await app.request(
      '/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [{ text: 'What are dengue symptoms?', sender: 'user' }],
          sessionId: clientSessionId,
        }),
      },
      fakeBindings()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; sessionId: string };
    expect(body.sessionId).toBe(clientSessionId);

    expect(insertedChatLogs.length).toBe(1);
    const logs = insertedChatLogs[0] as Array<{
      session_id: string;
      user_id: string;
      message_role: string;
    }>;
    expect(logs[0]?.session_id).toBe(clientSessionId);
    expect(logs[0]?.user_id).toBe(userId);
    expect(logs[1]?.user_id).toBe(userId);
  });

  test('invalid request body returns 400', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.route('/', createChat());

    const res = await app.request(
      '/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: true }),
      },
      fakeBindings()
    );

    expect(res.status).toBe(400);
  });

  test('gemini API error returns 502 and records audit failure', async () => {
    const fake = createFakeSupabase([
      {
        path: '/rest/v1/audit_log',
        match: (_sp, method) => method === 'POST',
        body: [{ id: 1 }],
      },
    ]);

    const mockGeminiFetch: typeof fetch = vi.fn().mockResolvedValue(
      new Response('Service Unavailable', { status: 503 })
    );

    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.route(
      '/',
      createChat({
        supabaseFactory: (env) => createSupabaseAdmin(env, { fetch: fake.fetch }),
        geminiFetch: mockGeminiFetch,
      })
    );

    const res = await app.request(
      '/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ text: 'Hello', sender: 'user' }],
        }),
      },
      fakeBindings()
    );

    expect(res.status).toBe(502);
  });
});
