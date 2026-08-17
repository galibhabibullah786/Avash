import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// Not React-Testing-Library — the react-dom + act harness
// docs/standards/testing.md permits for jsdom checks (see
// apps/web/src/features/map/useLeafletMap.test.ts). Heavy dependencies
// (session, the mutation, the third-party Turnstile widget) are mocked so
// this exercises only the location-status wiring B-T05 adds.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/env', () => ({
  env: {
    apiBaseUrl: 'https://api.example.test',
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key',
    turnstileSiteKey: 'test-site-key',
  },
}));

vi.mock('../features/auth/SessionProvider', () => ({
  useSession: () => ({ accessToken: null }),
}));

vi.mock('../features/reports/useSubmitBreedingReport', () => ({
  useSubmitBreedingReport: () => ({
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
  }),
}));

vi.mock('../features/reports/TurnstileWidget', () => ({
  TurnstileWidget: () => null,
}));

describe('Report — location spinner + disabled inputs (feature 9, B-T05)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const originalGeolocation = (navigator as unknown as { geolocation?: unknown }).geolocation;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      configurable: true,
    });
    vi.resetModules();
  });

  async function mount() {
    const { default: Report } = await import('./Report');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(Report));
    });
  }

  test('lat/lng inputs are disabled while a device fix is requesting', async () => {
    const getCurrentPosition = vi.fn(); // never calls back — stays "requesting"
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });

    await mount();

    const useMyLocation = container?.querySelector('[data-testid="use-my-location"]') as HTMLButtonElement;
    act(() => {
      useMyLocation.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const lat = container?.querySelector('#report-lat') as HTMLInputElement;
    const lng = container?.querySelector('#report-lng') as HTMLInputElement;
    expect(lat.disabled).toBe(true);
    expect(lng.disabled).toBe(true);
    expect(useMyLocation.disabled).toBe(true);
  });

  test('lat/lng inputs are enabled again after a permission denial', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });

    await mount();

    const useMyLocation = container?.querySelector('[data-testid="use-my-location"]') as HTMLButtonElement;
    act(() => {
      useMyLocation.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const lat = container?.querySelector('#report-lat') as HTMLInputElement;
    const lng = container?.querySelector('#report-lng') as HTMLInputElement;
    expect(lat.disabled).toBe(false);
    expect(lng.disabled).toBe(false);

    const denied = container?.querySelector('[data-testid="location-permission-denied"]');
    expect(denied).not.toBeNull();
  });
});
