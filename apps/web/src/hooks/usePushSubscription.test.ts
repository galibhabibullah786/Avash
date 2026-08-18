import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { usePushSubscription, type UsePushSubscriptionResult } from './usePushSubscription';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.test' } }));

describe('usePushSubscription', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const originalNotification = (globalThis as { Notification?: unknown }).Notification;
  const originalServiceWorker = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;

    if (originalNotification === undefined) {
      delete (globalThis as { Notification?: unknown }).Notification;
    } else {
      (globalThis as { Notification?: unknown }).Notification = originalNotification;
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalServiceWorker,
      configurable: true,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mount(accessToken: string | null = 'token-1'): { latest: () => UsePushSubscriptionResult } {
    let latest: UsePushSubscriptionResult | undefined;

    function Harness() {
      latest = usePushSubscription(accessToken);
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

  test('reports "unsupported" and never throws when no Notification global is present', async () => {
    delete (globalThis as { Notification?: unknown }).Notification;
    const { latest } = mount();

    expect(latest().status).toBe('unsupported');

    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('unsupported');
  });

  test('reports "denied" and never touches pushManager when permission is denied', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    (globalThis as { Notification?: unknown }).Notification = { requestPermission, permission: 'default' };
    const subscribeSpy = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { subscribe: subscribeSpy } }) },
      configurable: true,
    });

    const { latest } = mount();

    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('denied');
    expect(subscribeSpy).not.toHaveBeenCalled();
  });

  test('subscribes and POSTs the subscription when permission is granted', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    (globalThis as { Notification?: unknown }).Notification = { requestPermission, permission: 'default' };

    const toJSON = () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } });
    const subscribeSpy = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.test/abc',
      toJSON,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { subscribe: subscribeSpy } }) },
      configurable: true,
    });

    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    const { latest } = mount('token-1');

    await act(async () => {
      await latest().subscribe();
    });

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(latest().status).toBe('subscribed');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      endpoint: 'https://push.example.test/abc',
      p256dh: 'p256dh-value',
      authKey: 'auth-value',
    });
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe('Bearer token-1');
  });

  test('reports "error" and sends no request when toJSON() carries no keys', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    (globalThis as { Notification?: unknown }).Notification = { requestPermission, permission: 'default' };

    const subscribeSpy = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.test/abc',
      toJSON: () => ({}),
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { subscribe: subscribeSpy } }) },
      configurable: true,
    });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { latest } = mount();

    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
