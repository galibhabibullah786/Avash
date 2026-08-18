import { describe, test, expect, afterEach, vi } from 'vitest';
import { ensureServiceWorkerRegistration, SERVICE_WORKER_URL } from './serviceWorker';

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
