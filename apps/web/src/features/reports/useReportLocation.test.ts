import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useReportLocation, type ReportLocationState } from './useReportLocation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useReportLocation', () => {
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

  function mount(): { latest: () => ReportLocationState } {
    let latest: ReportLocationState | undefined;

    function Harness() {
      latest = useReportLocation();
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

  test('requesting is true while the device fix is in flight', () => {
    const getCurrentPosition = vi.fn(); // never calls back — in-flight
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });

    const { latest } = mount();
    act(() => {
      latest().requestDeviceLocation();
    });

    expect(latest().requesting).toBe(true);
    expect(latest().permissionDenied).toBe(false);
  });

  test('permissionDenied is true and requesting settles to false after a denial', () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });

    const { latest } = mount();
    act(() => {
      latest().requestDeviceLocation();
    });

    expect(latest().requesting).toBe(false);
    expect(latest().permissionDenied).toBe(true);
  });

  test('a granted device fix populates lat/lng with source "device"', () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 23.8, longitude: 90.4 } } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });

    const { latest } = mount();
    act(() => {
      latest().requestDeviceLocation();
    });

    expect(latest().lat).toBe(23.8);
    expect(latest().lng).toBe(90.4);
    expect(latest().source).toBe('device');
  });

  test('manual entry sets source to "manual" and is not clobbered by a late device fix', () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });

    const { latest } = mount();
    act(() => {
      latest().setManualLat(1.5);
      latest().setManualLng(2.5);
    });

    expect(latest().source).toBe('manual');
    expect(latest().lat).toBe(1.5);
    expect(latest().lng).toBe(2.5);
  });

  test('no geolocation API present yields permissionDenied on request', () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });

    const { latest } = mount();
    act(() => {
      latest().requestDeviceLocation();
    });

    expect(latest().permissionDenied).toBe(true);
    expect(latest().requesting).toBe(false);
  });
});
