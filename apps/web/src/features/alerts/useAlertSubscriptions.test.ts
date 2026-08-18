import { describe, test, expect, vi, beforeEach } from 'vitest';

let selectResult: { data: unknown; error: unknown } = { data: [], error: null };
const eqMock = vi.fn(() => selectResult);
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: { from: fromMock },
}));

describe('fetchAlertSubscriptions', () => {
  beforeEach(() => {
    vi.resetModules();
    selectResult = { data: [], error: null };
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
  });

  test('reads only active rows from alert_subscriptions, scoped by RLS not a manual filter', async () => {
    const { fetchAlertSubscriptions } = await import('./useAlertSubscriptions');
    await fetchAlertSubscriptions();

    expect(fromMock).toHaveBeenCalledWith('alert_subscriptions');
    expect(selectMock).toHaveBeenCalledWith('id, radius_m, active');
    expect(eqMock).toHaveBeenCalledWith('active', true);
  });

  test('maps rows to the DTO shape', async () => {
    selectResult = {
      data: [
        { id: 'sub-1', radius_m: 2000, active: true },
        { id: 'sub-2', radius_m: 5000, active: true },
      ],
      error: null,
    };
    const { fetchAlertSubscriptions } = await import('./useAlertSubscriptions');
    const rows = await fetchAlertSubscriptions();

    expect(rows).toEqual([
      { id: 'sub-1', radiusM: 2000, active: true },
      { id: 'sub-2', radiusM: 5000, active: true },
    ]);
  });

  test('a malformed row (missing/wrong-typed fields) resolves to safe defaults rather than throwing', async () => {
    selectResult = { data: [{ id: 42, radius_m: 'not-a-number', active: null }], error: null };
    const { fetchAlertSubscriptions } = await import('./useAlertSubscriptions');
    const rows = await fetchAlertSubscriptions();

    expect(rows).toEqual([{ id: '', radiusM: 0, active: false }]);
  });

  test('a Supabase/PostgREST error surfaces as a generic message, never the raw error', async () => {
    selectResult = { data: null, error: { message: 'permission denied for table alert_subscriptions' } };
    const { fetchAlertSubscriptions } = await import('./useAlertSubscriptions');

    await expect(fetchAlertSubscriptions()).rejects.toThrow('Unable to load your alert subscriptions right now.');
  });

  test('a null data response resolves to an empty array, not a crash', async () => {
    selectResult = { data: null, error: null };
    const { fetchAlertSubscriptions } = await import('./useAlertSubscriptions');

    await expect(fetchAlertSubscriptions()).resolves.toEqual([]);
  });
});
