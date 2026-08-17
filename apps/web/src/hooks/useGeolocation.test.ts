import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useGeolocation, type UseGeolocationResult } from './useGeolocation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useGeolocation', () => {
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
    vi.restoreAllMocks();
  });

  function mount(): { latest: () => UseGeolocationResult } {
    let latest: UseGeolocationResult | undefined;

    function Harness() {
      latest = useGeolocation();
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(Harness));
    });

    return {
      latest: () => {
        if (!latest) throw new Error('hook did not render');
        return latest;
      },
    };
  }

  test('status is "unavailable" when navigator.geolocation is absent', () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    const { latest } = mount();

    act(() => {
      latest().request();
    });

    expect(latest().status).toBe('unavailable');
    expect(latest().lat).toBeNull();
  });

  test('status becomes "granted" with lat/lng on a successful position', () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 23.8, longitude: 90.4 },
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    const { latest } = mount();

    act(() => {
      latest().request();
    });

    expect(latest().status).toBe('granted');
    expect(latest().lat).toBe(23.8);
    expect(latest().lng).toBe(90.4);
  });

  test('status becomes "denied" when the browser reports an error', () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    const { latest } = mount();

    act(() => {
      latest().request();
    });

    expect(latest().status).toBe('denied');
  });

  test('status is "requesting" synchronously after request() is called', () => {
    const getCurrentPosition = vi.fn(); // never calls back — simulates an in-flight request
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    const { latest } = mount();

    act(() => {
      latest().request();
    });

    expect(latest().status).toBe('requesting');
  });
});
