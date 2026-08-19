import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  ensureServiceWorkerRegistration,
  listenForServiceWorkerNavigation,
  SERVICE_WORKER_URL,
} from './serviceWorker';

describe('ensureServiceWorkerRegistration', () => {
  const original = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;

  afterEach(() => {
    Object.defineProperty(navigator, 'serviceWorker', { value: original, configurable: true });
    vi.restoreAllMocks();
  });

  function stub(value: unknown) {
    Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
  }

  test('registers /sw.js when nothing is registered yet', async () => {
    const registration = { active: {} };
    const register = vi.fn().mockResolvedValue(registration);
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    stub({ register, getRegistration, ready: Promise.resolve(registration) });

    const result = await ensureServiceWorkerRegistration();

    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
    expect(result).toBe(registration);
  });

  test('reuses an existing registration rather than re-registering on every call', async () => {
    const registration = { active: {} };
    const register = vi.fn();
    stub({
      register,
      getRegistration: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
    });

    expect(await ensureServiceWorkerRegistration()).toBe(registration);
    expect(register).not.toHaveBeenCalled();
  });

  test('waits for activation before resolving — PushManager.subscribe() needs an ACTIVE worker', async () => {
    const installing = { active: null };
    const activated = { active: {} };
    let readyResolved = false;
    const ready = Promise.resolve(activated).then((value) => {
      readyResolved = true;
      return value;
    });
    stub({
      register: vi.fn().mockResolvedValue(installing),
      getRegistration: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue(activated),
      ready,
    });

    const result = await ensureServiceWorkerRegistration();

    expect(readyResolved).toBe(true);
    expect(result).toBe(activated);
  });

  test('returns null instead of throwing when service workers are unavailable', async () => {
    // Plain HTTP on a non-localhost origin, some webviews, and jsdom.
    stub(undefined);
    expect(await ensureServiceWorkerRegistration()).toBeNull();
  });

  test('returns null instead of hanging when registration is rejected', async () => {
    stub({
      register: vi.fn().mockRejectedValue(new Error('SecurityError')),
      getRegistration: vi.fn().mockResolvedValue(undefined),
      // Never settles, exactly as a real browser's `ready` does when
      // nothing is registered.
      ready: new Promise(() => {}),
    });

    expect(await ensureServiceWorkerRegistration()).toBeNull();
  });
});

describe('listenForServiceWorkerNavigation', () => {
  const original = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;

  afterEach(() => {
    Object.defineProperty(navigator, 'serviceWorker', { value: original, configurable: true });
    vi.restoreAllMocks();
  });

  function stub(value: unknown) {
    Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
  }

  test('calls navigate with the url from a well-formed avash:navigate message', () => {
    let handler: ((event: unknown) => void) | undefined;
    const addEventListener = vi.fn((type: string, fn: (event: unknown) => void) => {
      if (type === 'message') handler = fn;
    });
    stub({ addEventListener, removeEventListener: vi.fn() });

    const navigate = vi.fn();
    listenForServiceWorkerNavigation(navigate);

    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    handler?.({ data: { type: 'avash:navigate', url: '/dashboard?announcement=abc' } });
    expect(navigate).toHaveBeenCalledWith('/dashboard?announcement=abc');
  });

  test('ignores a message of a different type or a malformed url', () => {
    let handler: ((event: unknown) => void) | undefined;
    stub({
      addEventListener: vi.fn((type: string, fn: (event: unknown) => void) => {
        if (type === 'message') handler = fn;
      }),
      removeEventListener: vi.fn(),
    });

    const navigate = vi.fn();
    listenForServiceWorkerNavigation(navigate);

    handler?.({ data: { type: 'something-else', url: '/dashboard' } });
    handler?.({ data: { type: 'avash:navigate', url: 123 } });
    handler?.({ data: null });
    handler?.({});
    expect(navigate).not.toHaveBeenCalled();
  });

  test('cleanup removes the listener', () => {
    const removeEventListener = vi.fn();
    stub({ addEventListener: vi.fn(), removeEventListener });

    const cleanup = listenForServiceWorkerNavigation(vi.fn());
    cleanup();

    expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  test('returns a no-op cleanup instead of throwing when serviceWorker is unavailable', () => {
    stub(undefined);
    const cleanup = listenForServiceWorkerNavigation(vi.fn());
    expect(() => cleanup()).not.toThrow();
  });
});
