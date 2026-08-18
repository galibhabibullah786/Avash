import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { usePushSubscription, type UsePushSubscriptionResult } from './usePushSubscription';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/env', () => ({ env: { apiBaseUrl: 'https://api.example.test' } }));

interface StubOptions {
  /** Absent = the browser has no worker registered yet, so one has to be registered. */
  existingRegistration?: boolean;
  pushManager?: unknown;
}

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

  function grantPermission() {
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn().mockResolvedValue('granted'),
      permission: 'default',
    };
  }

  /**
   * Stands in for `navigator.serviceWorker`. `register` is part of the
   * shape because the hook registers `public/sw.js` on demand — a browser
   * that has never loaded the app has no registration to find, which is
   * exactly the state this whole feature used to fail in.
   */
  function stubServiceWorker(options: StubOptions = {}) {
    const registration = { active: {}, pushManager: options.pushManager };
    const getRegistration = vi.fn().mockResolvedValue(options.existingRegistration === false ? undefined : registration);
    const register = vi.fn().mockImplementation(async () => {
      getRegistration.mockResolvedValue(registration);
      return registration;
    });
    const container = { getRegistration, register, ready: Promise.resolve(registration) };
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    return { getRegistration, register };
  }

  function defaultPushManager() {
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.test/abc',
      toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
    });
    return { pushManager: { subscribe, getSubscription: vi.fn().mockResolvedValue(undefined) }, subscribe };
  }

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
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn().mockResolvedValue('denied'),
      permission: 'default',
    };
    const { pushManager, subscribe } = defaultPushManager();
    stubServiceWorker({ pushManager });

    const { latest } = mount();

    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('denied');
    expect(subscribe).not.toHaveBeenCalled();
  });

  test('subscribes and POSTs the subscription when permission is granted', async () => {
    grantPermission();
    const { pushManager, subscribe } = defaultPushManager();
    stubServiceWorker({ pushManager });

    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    const { latest } = mount('token-1');

    await act(async () => {
      await latest().subscribe();
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(latest().status).toBe('subscribed');
    expect(capturedInit?.method).toBe('POST');
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      endpoint: 'https://push.example.test/abc',
      p256dh: 'p256dh-value',
      authKey: 'auth-value',
    });
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe('Bearer token-1');
  });

  test('registers the service worker when the browser has none — otherwise there is nothing for a push to wake', async () => {
    grantPermission();
    const { pushManager } = defaultPushManager();
    const { register } = stubServiceWorker({ pushManager, existingRegistration: false });

    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { latest } = mount();

    await act(async () => {
      await latest().subscribe();
    });

    // Before this, the hook only ever called getRegistration(), which
    // resolves to undefined on a browser that has never registered one —
    // and nothing anywhere in the app registered it.
    expect(register).toHaveBeenCalledWith('/sw.js');
    expect(latest().status).toBe('subscribed');
  });

  test('reuses a subscription already bound to the same VAPID key rather than minting a new endpoint', async () => {
    grantPermission();
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.test/new',
      toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
    });
    const getSubscription = vi.fn().mockResolvedValue(undefined);
    stubServiceWorker({ pushManager: { subscribe, getSubscription } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { latest } = mount();
    await act(async () => {
      await latest().subscribe();
    });

    // Take the key the hook actually derived from the configured VAPID
    // public key rather than re-deriving it here — a second copy of that
    // base64url decoding in the test would be asserting the test's own
    // arithmetic, not the hook's.
    const usedKey = subscribe.mock.calls[0]?.[0]?.applicationServerKey as Uint8Array;
    const unsubscribe = vi.fn().mockResolvedValue(true);
    getSubscription.mockResolvedValue({
      endpoint: 'https://push.example.test/existing',
      options: { applicationServerKey: usedKey.buffer },
      toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
      unsubscribe,
    });
    subscribe.mockClear();

    await act(async () => {
      await latest().subscribe();
    });

    expect(subscribe).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(latest().status).toBe('subscribed');
  });

  test('drops a subscription bound to a DIFFERENT VAPID key — subscribe() would reject outright otherwise', async () => {
    grantPermission();
    const { pushManager, subscribe } = defaultPushManager();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    (pushManager.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      endpoint: 'https://push.example.test/stale',
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      unsubscribe,
    });
    stubServiceWorker({ pushManager });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { latest } = mount();
    await act(async () => {
      await latest().subscribe();
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(latest().status).toBe('subscribed');
  });

  test('reports "error" and sends no request when toJSON() carries no keys', async () => {
    grantPermission();
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.test/abc',
      toJSON: () => ({}),
    });
    stubServiceWorker({ pushManager: { subscribe, getSubscription: vi.fn().mockResolvedValue(undefined) } });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { latest } = mount();

    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('reports "error" rather than hanging when the service worker cannot be registered at all', async () => {
    grantPermission();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
        register: vi.fn().mockRejectedValue(new Error('SecurityError')),
        // Never settles, as it does in a real browser with nothing
        // registered — awaiting it unconditionally would hang forever.
        ready: new Promise(() => {}),
      },
      configurable: true,
    });

    const { latest } = mount();

    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('error');
  });
});
