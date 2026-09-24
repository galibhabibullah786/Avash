import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const rangeMock = vi.fn();
const orderMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

function wireChain(result: { data: unknown; error: unknown; count: number | null }) {
  fromMock.mockReturnValue({ select: selectMock });
  selectMock.mockReturnValue({ eq: eqMock });
  eqMock.mockReturnValue({ order: orderMock });
  orderMock.mockReturnValue({ range: rangeMock });
  rangeMock.mockResolvedValue(result);
}

describe('fetchPendingReports (PostgREST pagination transport, baseline fact 2)', () => {
  beforeEach(() => {
    vi.resetModules();
    rangeMock.mockReset();
    orderMock.mockReset();
    eqMock.mockReset();
    selectMock.mockReset();
    fromMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('the .range() bounds for page 3 at size 25 are (50, 74)', async () => {
    wireChain({ data: [], error: null, count: 0 });
    const { fetchPendingReports } = await import('./usePendingReports');

    await fetchPendingReports({ page: 3, pageSize: 25, dir: 'asc', status: 'pending' });

    expect(rangeMock).toHaveBeenCalledWith(50, 74);
  });

  test('a null count yields page.total: null rather than 0', async () => {
    wireChain({ data: [], error: null, count: null });
    const { fetchPendingReports } = await import('./usePendingReports');

    const result = await fetchPendingReports({ page: 1, pageSize: 25, dir: 'asc', status: 'pending' });

    expect(result.page.total).toBeNull();
  });

  test('a numeric count is passed through as page.total', async () => {
    wireChain({ data: [], error: null, count: 312 });
    const { fetchPendingReports } = await import('./usePendingReports');

    const result = await fetchPendingReports({ page: 1, pageSize: 25, dir: 'asc', status: 'pending' });

    expect(result.page.total).toBe(312);
  });

  test('a PostgREST error surfaces as a generic Error, not the raw driver message', async () => {
    wireChain({ data: null, error: { message: 'relation does not exist' }, count: null });
    const { fetchPendingReports } = await import('./usePendingReports');

    await expect(
      fetchPendingReports({ page: 1, pageSize: 25, dir: 'asc', status: 'pending' })
    ).rejects.toThrow('Unable to load the moderation queue.');
  });

  test('an unrecognized ai_validation shape is dropped to null rather than trusted', async () => {
    wireChain({
      data: [
        {
          id: 'r1',
          description: 'x',
          photo_url: null,
          status: 'pending',
          created_at: '2026-08-01T00:00:00.000Z',
          ai_validation: { unexpectedShape: true },
        },
      ],
      error: null,
      count: 1,
    });
    const { fetchPendingReports } = await import('./usePendingReports');

    const result = await fetchPendingReports({ page: 1, pageSize: 25, dir: 'asc', status: 'pending' });

    expect(result.items[0]?.ai_validation).toBeNull();
  });

  test('sorts on the mapped column for the closed sort enum', async () => {
    wireChain({ data: [], error: null, count: 0 });
    const { fetchPendingReports } = await import('./usePendingReports');

    await fetchPendingReports({ page: 1, pageSize: 25, sort: 'createdAt', dir: 'desc', status: 'pending' });

    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
