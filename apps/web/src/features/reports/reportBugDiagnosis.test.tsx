import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReportLocationPicker } from './components/ReportLocationPicker';
import { ReportSubmissionList } from './components/ReportSubmissionList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../auth/SessionProvider', () => ({
  useSession: () => ({ accessToken: null, user: null }),
}));

vi.mock('../../../lib/env', () => ({
  env: {
    apiBaseUrl: 'http://localhost:8787',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'test-anon-key',
    turnstileSiteKey: 'test-turnstile-site-key',
  },
}));

describe('Report page bug diagnosis', () => {
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

  test('Bug 2: location-permission-denied alert msg must NOT remain visible when lat and lng are present', () => {
    render(
      createElement(ReportLocationPicker, {
        lat: 23.8103,
        lng: 90.4125,
        onCoordinatesChange: () => {},
        locating: false,
        locationError: 'অবস্থান শনাক্ত করা যায়নি। অনুগ্রহ করে ব্রাউজারে লোকেশন পারমিশন দিন এবং পুনরায় চেষ্টা করুন।',
        onUseMyLocation: () => {},
      })
    );

    const errorEl = container?.querySelector('[data-testid="location-permission-denied"]');
    // When lat/lng are successfully set/fetched, the unable error message should be hidden
    expect(errorEl).toBeNull();
  });

  test('Bug 3 (UI): ReportSubmissionList should show report items or query for all reports even when hasLocation is false', () => {
    render(createElement(ReportSubmissionList));

    // When hasLocation is false, it should immediately trigger fetching all reports (loading/items/empty)
    // rather than blocking behind location prompt
    const loadingOrItems = container?.querySelector(
      '[data-testid="report-submission-list-loading"], [data-testid="report-submission-list-items"], [data-testid="report-submission-list-empty"]'
    );
    
    expect(loadingOrItems).not.toBeNull();
  });

  test('Bug 1: TurnstileWidget handles local dev gracefully and auto-verifies when script is unreachable', async () => {
    const onVerify = vi.fn();
    const { TurnstileWidget } = await import('./components/TurnstileWidget');

    render(
      createElement(TurnstileWidget, {
        siteKey: '0x4AAAAAAEF8Y4SGwo17ABsD', // production key
        onVerify,
      })
    );

    // Simulate script error (e.g. adblocker, network unreachable)
    const script = document.querySelector(`script[src="${'https://challenges.cloudflare.com/turnstile/v0/api.js'}"]`) as HTMLScriptElement;
    if (script?.onerror) {
      act(() => {
        (script.onerror as (e: Event) => void)(new Event('error'));
      });
    }

    // Wait a tick for promise rejection / fallback in test/localhost environment
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onVerify).toHaveBeenCalledWith('XXXX.DUMMY.LOCALDEV.TOKEN');
  });
});
