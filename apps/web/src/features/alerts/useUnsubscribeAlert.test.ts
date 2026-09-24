import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// useUnsubscribeAlert.ts imports useAlertSubscription.ts for its query
// key, which imports the real lib/supabaseClient.ts — createClient()
// throws at module load without the full env shape.
vi.mock('../../lib/env', () => ({
  env: {
    apiBaseUrl: 'https://api.example.test',
    supabaseUrl: 'https://project.supabase.test',
    supabaseAnonKey: 'anon-key',
    turnstileSiteKey: 'turnstile-key',
  },
}));

describe('unsubscribeAlert', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('sends a bodiless DELETE with the caller Bearer token', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'sub-1' }) } as Response);
    });

    const { unsubscribeAlert } = await import('./useUnsubscribeAlert');
    await unsubscribeAlert('token-1');

    expect(capturedUrl).toBe('https://api.example.test/api/alerts/subscribe');
    expect(capturedInit?.method).toBe('DELETE');
    // Nothing identifies the row: the server resolves it from the JWT, so
    // a caller can never name someone else's subscription.
    expect(capturedInit?.body).toBeUndefined();
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe('Bearer token-1');
  });

  test('resolves without throwing when there was nothing to remove', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: null }) } as Response);

    const { unsubscribeAlert } = await import('./useUnsubscribeAlert');
    await expect(unsubscribeAlert('token-1')).resolves.toBeUndefined();
  });

  test('rejects with a generic error on a transport failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { unsubscribeAlert } = await import('./useUnsubscribeAlert');
    await expect(unsubscribeAlert('token-1')).rejects.toThrow('Unable to reach the server');
  });

  test('rejects with a generic error on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
    const { unsubscribeAlert } = await import('./useUnsubscribeAlert');
    await expect(unsubscribeAlert('token-1')).rejects.toThrow('Request failed with status 503');
  });
});
