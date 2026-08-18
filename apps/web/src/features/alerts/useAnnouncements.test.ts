import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.test' } }));

function mockFetchOnce(response: Partial<Response> | null, shouldReject = false) {
  global.fetch = vi.fn().mockImplementation(() => {
    if (shouldReject) return Promise.reject(new Error('network down'));
    return Promise.resolve(response as Response);
  });
}

const validAnnouncement = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  title: 'Rising risk nearby',
  body: 'Dengue risk has crossed into the high band in your area.',
  lat: 23.8,
  lng: 90.4,
  radiusM: 5000,
  targetRoles: [],
  expiresAt: '2026-08-20T00:00:00.000Z',
  authorId: '223e4567-e89b-42d3-a456-426614174000',
  createdAt: '2026-08-18T00:00:00.000Z',
};

describe('fetchAnnouncements', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('sends lat/lng and pagination as query params', async () => {
    let capturedUrl: string | undefined;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          items: [],
          page: { page: 1, pageSize: 25, total: 0, hasNext: false, sort: null, dir: 'asc' },
          requestId: 'req-1',
        }),
      } as Response);
    });

    const { fetchAnnouncements } = await import('./useAnnouncements');
    await fetchAnnouncements('token-1', { page: 1, pageSize: 25, lat: 23.8, lng: 90.4 });

    expect(capturedUrl).toBe(
      'https://api.example.test/api/announcements?page=1&pageSize=25&lat=23.8&lng=90.4'
    );
  });

  test('resolves with parsed items on a schema-matching 200', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [validAnnouncement],
        page: { page: 1, pageSize: 25, total: 1, hasNext: false, sort: null, dir: 'asc' },
        requestId: 'req-1',
      }),
    });
    const { fetchAnnouncements } = await import('./useAnnouncements');
    const data = await fetchAnnouncements('token-1', { page: 1, pageSize: 25, lat: 23.8, lng: 90.4 });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.title).toBe('Rising risk nearby');
  });

  test('rejects with a generic error on a transport failure', async () => {
    mockFetchOnce(null, true);
    const { fetchAnnouncements } = await import('./useAnnouncements');
    await expect(
      fetchAnnouncements('token-1', { page: 1, pageSize: 25, lat: 23.8, lng: 90.4 })
    ).rejects.toThrow('Unable to reach the server');
  });

  test('rejects when the payload does not match the schema', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ title: 'missing everything else' }] }),
    });
    const { fetchAnnouncements } = await import('./useAnnouncements');
    await expect(
      fetchAnnouncements('token-1', { page: 1, pageSize: 25, lat: 23.8, lng: 90.4 })
    ).rejects.toThrow('Response did not match the expected shape');
  });
});
