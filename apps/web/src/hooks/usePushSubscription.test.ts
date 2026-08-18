import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { usePushSubscription, type UsePushSubscriptionResult } from './usePushSubscription';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VAPID_KEY = 'BHdpWR6UsY39u1BHWDwuEs4N6Z3yfQ0nJcQZ0oGAxD4Yl8Yy3xVGGaRRPnFOaBEHtUlkGL1XPMZWx0IJvJHTaHM';

let vapidPublicKey: string | null = VAPID_KEY;
vi.mock('./../lib/env', () => ({
  get env() {
    return { apiBaseUrl: 'https://api.example.test', vapidPublicKey };
  },
}));

// Stands in for the caller's own push_subscriptions read (RLS-scoped).
let storedEndpoints: string[] = [];
let readError: unknown = null;
const limitMock = vi.fn(async () => ({
  data: storedEndpoints.map((endpoint) => ({ id: endpoint })),
  error: readError,
}));
const eqMock = vi.fn(() => ({ limit: limitMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));

interface StubOptions {
  existingRegistration?: boolean;
  pushManager?: unknown;
}

describe('usePushSubscription', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const originalNotification = (globalThis as { Notification?: unknown }).Notification;
  const originalServiceWorker = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;

  beforeEach(() => {
    vapidPublicKey = VAPID_KEY;
    storedEndpoints = [];
    readError = null;
    limitMock.mockClear();
    eqMock.mockClear();
    selectMock.mockClear();
  });

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

  function setPermission(permission: NotificationPermission, requestResult: NotificationPermission = 'granted') {
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn().mockResolvedValue(requestResult),
      permission,
    };
  }

  function stubServiceWorker(options: StubOptions = {}) {
    const registration = { active: {}, pushManager: options.pushManager };
    const getRegistration = vi.fn().mockResolvedValue(options.existingRegistration === false ? undefined : registration);
    const register = vi.fn().mockImplementation(async () => {
      getRegistration.mockResolvedValue(registration);
      return registration;
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration, register, ready: Promise.resolve(registration) },
      configurable: true,
    });
    return { getRegistration, register };
  }

  /** A subscription bound to the key the hook derives from VAPID_KEY. */
  function boundSubscription(endpoint = 'https://push.example.test/abc') {
    const padding = '='.repeat((4 - (VAPID_KEY.length % 4)) % 4);
    const raw = atob(`${VAPID_KEY}${padding}`.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return {
      endpoint,
      options: { applicationServerKey: bytes.buffer },
      toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
  }

  function defaultPushManager() {
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.test/abc',
      toJSON: () => ({ keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
    });
    return { pushManager: { subscribe, getSubscription: vi.fn().mockResolvedValue(undefined) }, subscribe };
  }

  async function mount(accessToken: string | null = 'token-1'): Promise<{ latest: () => UsePushSubscriptionResult }> {
    let latest: UsePushSubscriptionResult | undefined;

    function Harness() {
      latest = usePushSubscription(accessToken);
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Awaited so the mount-time status resolution settles — the hook
    // starts at 'checking' precisely so it never flashes "Enable" at a
    // browser that turns out to be subscribed.
    await act(async () => {
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
    const { latest } = await mount();

    expect(latest().status).toBe('unsupported');

    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('unsupported');
  });

  test('reports "unconfigured" when no VAPID key was built into the bundle', async () => {
    // A deployment that forgot VITE_PUBLIC_VAPID_PUBLIC_KEY. Distinct
    // from 'error' on purpose: nothing the user does can fix it, and it
    // used to surface as a generic "please try again".
    vapidPublicKey = null;
    setPermission('default');
    stubServiceWorker(defaultPushManager());
    const { latest } = await mount();

    expect(latest().status).toBe('unconfigured');

    await act(async () => {
      await latest().subscribe();
    });
    expect(latest().status).toBe('unconfigured');
  });

  test('a browser that is ALREADY subscribed reports "subscribed" on mount, without any click', async () => {
    // The reported bug: permission granted and a live subscription, but
    // the control reset to "Enable push notifications" on every reload,
    // because status was derived from Notification.permission alone.
    setPermission('granted');
    const subscription = boundSubscription();
    storedEndpoints = [subscription.endpoint];
    const subscribe = vi.fn();
    stubServiceWorker({
      pushManager: { subscribe, getSubscription: vi.fn().mockResolvedValue(subscription) },
    });

    const { latest } = await mount();

    expect(latest().status).toBe('subscribed');
    expect(subscribe).not.toHaveBeenCalled();
  });

  test('an already-subscribed browser whose row is missing server-side re-registers itself', async () => {
    setPermission('granted');
    const subscription = boundSubscription();
    storedEndpoints = []; // the server has no row for this endpoint
    stubServiceWorker({
      pushManager: { subscribe: vi.fn(), getSubscription: vi.fn().mockResolvedValue(subscription) },
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    global.fetch = fetchSpy;

    const { latest } = await mount();

    // Otherwise this browser is permanently undeliverable: it believes it
    // is subscribed, so it never re-registers, and the server has nothing
    // to send to.
    expect(latest().status).toBe('subscribed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  test('an already-registered endpoint is NOT re-posted — a page load must not be a write', async () => {
    setPermission('granted');
    const subscription = boundSubscription();
    storedEndpoints = [subscription.endpoint];
    stubServiceWorker({
      pushManager: { subscribe: vi.fn(), getSubscription: vi.fn().mockResolvedValue(subscription) },
    });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    await mount();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a failed server read leaves the subscription alone rather than re-registering blindly', async () => {
    setPermission('granted');
    const subscription = boundSubscription();
    readError = { message: 'permission denied for table push_subscriptions' };
    stubServiceWorker({
      pushManager: { subscribe: vi.fn(), getSubscription: vi.fn().mockResolvedValue(subscription) },
    });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { latest } = await mount();

    expect(latest().status).toBe('subscribed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('permission granted but no subscription is "idle" — the user still has to click', async () => {
    setPermission('granted');
    stubServiceWorker(defaultPushManager());

    const { latest } = await mount();

    expect(latest().status).toBe('idle');
  });

  test('a subscription bound to a DIFFERENT VAPID key is not reported as subscribed', async () => {
    setPermission('granted');
    stubServiceWorker({
      pushManager: {
        subscribe: vi.fn(),
        getSubscription: vi.fn().mockResolvedValue({
          endpoint: 'https://push.example.test/stale',
          options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
        }),
      },
    });

    const { latest } = await mount();

    // It cannot receive this deployment's pushes, so claiming "on" would
    // be a lie the user has no way to detect.
    expect(latest().status).toBe('idle');
  });

  test('reports "denied" on mount without touching the service worker', async () => {
    setPermission('denied');
    const { register } = stubServiceWorker(defaultPushManager());

    const { latest } = await mount();

    expect(latest().status).toBe('denied');
    expect(register).not.toHaveBeenCalled();
  });

  test('reports "denied" and never touches pushManager when permission is refused at the prompt', async () => {
    setPermission('default', 'denied');
    const { pushManager, subscribe } = defaultPushManager();
    stubServiceWorker({ pushManager });

    const { latest } = await mount();
    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('denied');
    expect(subscribe).not.toHaveBeenCalled();
  });

  test('subscribes and POSTs the subscription when permission is granted', async () => {
    setPermission('default');
    const { pushManager, subscribe } = defaultPushManager();
    stubServiceWorker({ pushManager });

    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedInit = init;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    const { latest } = await mount('token-1');
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
    setPermission('default');
    const { pushManager } = defaultPushManager();
    const { register } = stubServiceWorker({ pushManager, existingRegistration: false });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { latest } = await mount();
    await act(async () => {
      await latest().subscribe();
    });

    expect(register).toHaveBeenCalledWith('/sw.js');
    expect(latest().status).toBe('subscribed');
  });

  test('drops a subscription bound to a DIFFERENT VAPID key — subscribe() would reject outright otherwise', async () => {
    setPermission('default');
    const { pushManager, subscribe } = defaultPushManager();
    const unsubscribe = vi.fn().mockResolvedValue(true);
    (pushManager.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      endpoint: 'https://push.example.test/stale',
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      unsubscribe,
    });
    stubServiceWorker({ pushManager });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { latest } = await mount();
    await act(async () => {
      await latest().subscribe();
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(latest().status).toBe('subscribed');
  });

  test('reuses a subscription already bound to the same key rather than minting a new endpoint', async () => {
    setPermission('default');
    const subscription = boundSubscription();
    const subscribe = vi.fn();
    stubServiceWorker({
      pushManager: { subscribe, getSubscription: vi.fn().mockResolvedValue(subscription) },
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const { latest } = await mount();
    await act(async () => {
      await latest().subscribe();
    });

    expect(subscribe).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(latest().status).toBe('subscribed');
  });

  test('reports "error" and sends no request when toJSON() carries no keys', async () => {
    setPermission('default');
    const subscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example.test/abc',
      toJSON: () => ({}),
    });
    stubServiceWorker({ pushManager: { subscribe, getSubscription: vi.fn().mockResolvedValue(undefined) } });
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { latest } = await mount();
    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('reports "error" rather than hanging when the service worker cannot be registered at all', async () => {
    setPermission('default');
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
        register: vi.fn().mockRejectedValue(new Error('SecurityError')),
        ready: new Promise(() => {}),
      },
      configurable: true,
    });

    const { latest } = await mount();
    await act(async () => {
      await latest().subscribe();
    });

    expect(latest().status).toBe('error');
  });
});
