import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.test' } }));

function mockFetchOnce(response: Partial<Response> | null, shouldReject = false) {
  global.fetch = vi.fn().mockImplementation(() => {
    if (shouldReject) return Promise.reject(new Error('network down'));
    return Promise.resolve(response as Response);
  });
}

const validCreateInput = {
  title: 'Rising risk nearby',
  body: 'Dengue risk has crossed into the high band in your area.',
  lat: 23.8,
  lng: 90.4,
  radiusM: 5000,
  targetRoles: [],
  expiresAt: '2026-08-20T00:00:00.000Z',
  accessToken: 'token-1',
};

describe('createAnnouncement', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('POSTs the announcement body and resolves with the created row', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({
          id: '123e4567-e89b-42d3-a456-426614174000',
          authorId: '223e4567-e89b-42d3-a456-426614174000',
          createdAt: '2026-08-18T00:00:00.000Z',
          title: validCreateInput.title,
          body: validCreateInput.body,
          lat: validCreateInput.lat,
          lng: validCreateInput.lng,
          radiusM: validCreateInput.radiusM,
          targetRoles: [],
          expiresAt: validCreateInput.expiresAt,
        }),
      } as Response);
    });

    const { createAnnouncement } = await import('./useCreateAnnouncement');
    const result = await createAnnouncement(validCreateInput);

    expect(result.id).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(capturedInit?.method).toBe('POST');
    const sentBody = JSON.parse(capturedInit?.body as string);
    expect(sentBody.accessToken).toBeUndefined();
    expect(sentBody.title).toBe(validCreateInput.title);
  });

  test('rejects with a generic error on a non-2xx response', async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    const { createAnnouncement } = await import('./useCreateAnnouncement');
    await expect(createAnnouncement(validCreateInput)).rejects.toThrow('Request failed with status 500');
  });

  test('surfaces the distinct sign-in-required message on a 403', async () => {
    mockFetchOnce({ ok: false, status: 403, json: async () => ({}) });
    const { createAnnouncement } = await import('./useCreateAnnouncement');
    await expect(createAnnouncement(validCreateInput)).rejects.toThrow('Sign-in required. Please sign in again.');
  });

  test('rejects with a generic error on a transport failure', async () => {
    mockFetchOnce(null, true);
    const { createAnnouncement } = await import('./useCreateAnnouncement');
    await expect(createAnnouncement(validCreateInput)).rejects.toThrow('Unable to reach the server');
  });
});
