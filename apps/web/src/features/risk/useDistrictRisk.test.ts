import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.test' } }));

function mockFetch(response: Partial<Response>) {
  global.fetch = vi.fn().mockResolvedValue(response as Response);
}

describe('fetchDistrictRisk', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('parses the district snapshot with probability fields', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        district: 'Dhaka',
        latitude: 23.8103,
        longitude: 90.4125,
        risk: 'Low',
        risk_score: 0.63,
        low_risk_probability: 0.63,
        medium_risk_probability: 0.22,
        high_risk_probability: 0.15,
        prediction_date: '2026-07-19',
      }),
    });

    const { fetchDistrictRisk } = await import('./useDistrictRisk');
    const result = await fetchDistrictRisk('Dhaka');

    expect(result.district).toBe('Dhaka');
    expect(result.high_risk_probability).toBe(0.15);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/api/risk-map?district=Dhaka',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('rejects a response missing probability fields', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ district: 'Dhaka', risk: 'Low' }),
    });

    const { fetchDistrictRisk } = await import('./useDistrictRisk');
    await expect(fetchDistrictRisk('Dhaka')).rejects.toThrow(
      'Response did not match the expected shape',
    );
  });
});
