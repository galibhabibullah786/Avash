import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Resources from './Resources';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/env', () => ({
  env: {
    apiBaseUrl: 'http://localhost:8787',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'test-anon-key',
    turnstileSiteKey: 'test-turnstile-site-key',
  },
}));

vi.mock('../features/resources/useBloodInventoryRealtime', () => ({
  useBloodInventoryRealtime: () => 'idle',
}));

describe('Resources page', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

  function render(element: React.ReactElement) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        createElement(QueryClientProvider, { client: queryClient }, element)
      );
    });
  }

  test('fetches all blood records by default and displays location filter toggle', async () => {
    let requestedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                inventoryId: 1,
                hospital: {
                  id: '11111111-1111-4111-8111-111111111111',
                  name: 'Dhaka Medical College',
                  address: 'Dhaka',
                  phone: '01700000000',
                  verified: true,
                  lat: 23.81,
                  lng: 90.41,
                },
                bloodGroup: 'O+',
                unitsAvailable: 15,
                plateletUnits: 5,
                distanceM: 0,
                updatedAt: new Date().toISOString(),
              },
            ],
            generatedAt: new Date().toISOString(),
            requestId: 'test-req',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    });

    render(createElement(Resources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Verify URL does not have lat or lng by default (all records)
    expect(requestedUrl).toContain('/api/resources/blood?bloodGroup=O%2B');
    expect(requestedUrl).not.toContain('lat=');

    // Toggle button should be present
    const toggleBtn = container?.querySelector('[data-testid="location-filter-toggle"]');
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn?.textContent).toContain('আমার নিকটস্থ হাসপাতাল');

    // Hospital row should be rendered
    const hospitalRow = container?.querySelector('[data-testid="hospital-row"]');
    expect(hospitalRow?.textContent).toContain('Dhaka Medical College');
  });
});
