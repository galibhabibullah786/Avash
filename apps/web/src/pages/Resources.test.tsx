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

  test('paginates blood availability results with per-page selector and navigation', async () => {
    const twelveResults = Array.from({ length: 12 }, (_, i) => ({
      inventoryId: i + 1,
      hospital: {
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        name: `Hospital #${i + 1}`,
        address: `Dhaka District ${i + 1}`,
        phone: '01700000000',
        verified: true,
        lat: 23.81,
        lng: 90.41,
      },
      bloodGroup: 'O+',
      unitsAvailable: 10 + i,
      plateletUnits: 5 + i,
      distanceM: 0,
      updatedAt: new Date().toISOString(),
    }));

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: twelveResults,
            generatedAt: new Date().toISOString(),
            requestId: 'test-pagination-req',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    });

    render(createElement(Resources));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Pagination container is rendered
    const pagination = container?.querySelector('[data-testid="resource-pagination"]');
    expect(pagination).toBeTruthy();
    expect(pagination?.textContent).toContain('মোট 12টি ফলাফলের মধ্যে 1 থেকে 10 দেখানো হচ্ছে');

    // Page 1 should render 10 rows
    let rows = container?.querySelectorAll('[data-testid="hospital-row"]');
    expect(rows).toHaveLength(10);
    expect(rows?.[0]?.textContent).toContain('Hospital #1');
    expect(rows?.[9]?.textContent).toContain('Hospital #10');

    // Click "Next"
    const nextBtn = container?.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement | null;
    expect(nextBtn).toBeTruthy();
    await act(async () => {
      nextBtn?.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    // Page 2 should render 2 rows
    rows = container?.querySelectorAll('[data-testid="hospital-row"]');
    expect(rows).toHaveLength(2);
    expect(rows?.[0]?.textContent).toContain('Hospital #11');
    expect(rows?.[1]?.textContent).toContain('Hospital #12');
    expect(pagination?.textContent).toContain('মোট 12টি ফলাফলের মধ্যে 11 থেকে 12 দেখানো হচ্ছে');

    // Change page size to 5
    const select = container?.querySelector('[data-testid="resource-page-size"]') as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    await act(async () => {
      if (select) {
        select.value = '5';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 20));
    });

    // Page 1 now has 5 rows
    rows = container?.querySelectorAll('[data-testid="hospital-row"]');
    expect(rows).toHaveLength(5);
    expect(pagination?.textContent).toContain('মোট 12টি ফলাফলের মধ্যে 1 থেকে 5 দেখানো হচ্ছে');
  });
});
