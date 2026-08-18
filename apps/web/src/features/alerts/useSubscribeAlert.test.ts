import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// subscribeAlert itself only needs apiBaseUrl, but useSubscribeAlert.ts
// (not exercised directly here) imports useAlertSubscriptions.ts for its
// query key, which imports the real lib/supabaseClient.ts — createClient()
// throws at module load without these, so the mock covers the full shape.
vi.mock('../../lib/env', () => ({
  env: {
    apiBaseUrl: 'https://api.example.test',
    supabaseUrl: 'https://project.supabase.test',
    supabaseAnonKey: 'anon-key',
    turnstileSiteKey: 'turnstile-key',
  },
}));

function mockFetchOnce(response: Partial<Response> | null, shouldReject = false) {
  global.fetch = vi.fn().mockImplementation(() => {
    if (shouldReject) return Promise.reject(new Error('network down'));
    return Promise.resolve(response as Response);
  });
}

describe('subscribeAlert', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('POSTs the subscription body with the caller Bearer token', async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl: string | undefined;
    global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    const { subscribeAlert } = await import('./useSubscribeAlert');
    await subscribeAlert({ lat: 23.8, lng: 90.4, radiusM: 2000, active: true, accessToken: 'token-1' });

    expect(capturedUrl).toBe('https://api.example.test/api/alerts/subscribe');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      lat: 23.8,
      lng: 90.4,
      radiusM: 2000,
      active: true,
    });
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe('Bearer token-1');
  });

  test('rejects with a generic error on a transport failure', async () => {
    mockFetchOnce(null, true);
    const { subscribeAlert } = await import('./useSubscribeAlert');
    await expect(
      subscribeAlert({ lat: 23.8, lng: 90.4, radiusM: 2000, active: true, accessToken: 'token-1' })
    ).rejects.toThrow('Unable to reach the server');
  });

  test('rejects with a generic error on a non-2xx response', async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    const { subscribeAlert } = await import('./useSubscribeAlert');
    await expect(
      subscribeAlert({ lat: 23.8, lng: 90.4, radiusM: 2000, active: true, accessToken: 'token-1' })
    ).rejects.toThrow('Request failed with status 500');
  });
});
