import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, test, expect, vi } from 'vitest';

/**
 * `apps/web/public/sw.js` is a raw script (not an ES module — it can't
 * import `packages/types`, per that file's own header comment), so it
 * can't be `import`ed directly. This loads its source into a sandboxed
 * `vm` context shaped like the service worker global scope (`self` IS the
 * global object, so `caches`/`fetch`/`clients` resolve as bare
 * identifiers exactly like they do in a real worker) and captures the
 * handlers it registers via `addEventListener` so they can be invoked
 * directly, the same technique this file needs for any future sw.js
 * behavior test.
 */
const SW_SOURCE = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');

interface FakeClient {
  url?: string;
  focus?: () => Promise<void> | void;
  navigate?: (url: string) => void;
  postMessage?: (message: unknown) => void;
}

function loadServiceWorker(overrides: {
  clientList?: FakeClient[];
  openWindow?: (url: string) => void;
} = {}) {
  const listeners: Record<string, (event: unknown) => unknown> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = overrides.openWindow ?? vi.fn();

  const sandbox: Record<string, unknown> = {
    addEventListener: (type: string, handler: (event: unknown) => unknown) => {
      listeners[type] = handler;
    },
    caches: {
      open: async () => ({ put: async () => undefined }),
      match: async () => undefined,
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async () => ({ ok: true }),
    skipWaiting: vi.fn(),
    clients: {
      matchAll: async () => overrides.clientList ?? [],
      openWindow,
      claim: vi.fn(),
    },
    registration: { showNotification },
    location: { origin: 'https://avash.test' },
    console,
    URL,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox);

  return { listeners, showNotification, openWindow };
}

function firePush(listeners: Record<string, (event: unknown) => unknown>, data: unknown) {
  const waitUntilPromises: unknown[] = [];
  listeners.push?.({
    data: { json: () => data },
    waitUntil: (p: unknown) => waitUntilPromises.push(p),
  });
  return Promise.all(waitUntilPromises);
}

describe('sw.js push handler — announcement payloads', () => {
  test('an announcement payload yields the per-announcement tag and the /dashboard?announcement=... deep link', async () => {
    const { listeners, showNotification } = loadServiceWorker();
    const announcementId = '11111111-1111-4111-8111-111111111111';

    await firePush(listeners, {
      kind: 'announcement',
      title: 'Dengue advisory',
      body: 'Boil water in your area.',
      announcementId,
    });

    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0] as [string, Record<string, unknown>];
    expect(title).toBe('Dengue advisory');
    expect(options.tag).toBe(`avash-announcement-${announcementId}`);
    expect(options.renotify).toBe(true);
    expect((options.data as { url: string }).url).toBe(`/dashboard?announcement=${announcementId}`);
  });

  test('an evil url field in the payload is ignored entirely — the link is always derived from the validated announcementId', async () => {
    const { listeners, showNotification } = loadServiceWorker();
    const announcementId = '22222222-2222-4222-8222-222222222222';

    await firePush(listeners, {
      kind: 'announcement',
      title: 'Advisory',
      body: 'Body',
      announcementId,
      url: 'https://evil.example/steal',
    });

    const [, options] = showNotification.mock.calls[0] as [string, Record<string, unknown>];
    expect((options.data as { url: string }).url).toBe(`/dashboard?announcement=${announcementId}`);
    expect((options.data as { url: string }).url).not.toContain('evil.example');
  });

  test('a non-UUID announcementId falls back to plain /dashboard with no query string', async () => {
    const { listeners, showNotification } = loadServiceWorker();

    await firePush(listeners, {
      kind: 'announcement',
      title: 'Advisory',
      body: 'Body',
      announcementId: 'not-a-uuid',
    });

    const [, options] = showNotification.mock.calls[0] as [string, Record<string, unknown>];
    expect((options.data as { url: string }).url).toBe('/dashboard');
  });

  test('a risk-alert (non-announcement) payload is unaffected — keeps the shared tag', async () => {
    const { listeners, showNotification } = loadServiceWorker();

    await firePush(listeners, { title: 'Risk rising', body: 'Body', regionCode: 'DHK-01' });

    const [, options] = showNotification.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.tag).toBe('avash-risk-alert');
    expect((options.data as { url: string }).url).toBe('/risk');
  });
});

describe('sw.js notificationclick handler', () => {
  function fireClick(listeners: Record<string, (event: unknown) => unknown>, url: string) {
    const waitUntilPromises: unknown[] = [];
    listeners.notificationclick?.({
      notification: { close: vi.fn(), data: { url } },
      waitUntil: (p: unknown) => waitUntilPromises.push(p),
    });
    return Promise.all(waitUntilPromises);
  }

  test('with a focused, same-origin client open, postMessage is sent and client.navigate() is NOT called', async () => {
    const navigate = vi.fn();
    const postMessage = vi.fn();
    const focus = vi.fn().mockResolvedValue(undefined);
    const client: FakeClient = { url: 'https://avash.test/dashboard', focus, navigate, postMessage };

    const { listeners, openWindow } = loadServiceWorker({ clientList: [client] });
    await fireClick(listeners, '/dashboard?announcement=abc');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: 'avash:navigate', url: '/dashboard?announcement=abc' });
    expect(navigate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  test('with no open clients, clients.openWindow() is called with the same target URL as before', async () => {
    const openWindow = vi.fn();
    const { listeners } = loadServiceWorker({ clientList: [], openWindow });

    await fireClick(listeners, '/dashboard?announcement=abc');

    expect(openWindow).toHaveBeenCalledWith('/dashboard?announcement=abc');
  });

  test('a client without postMessage falls back to client.navigate() unchanged', async () => {
    const navigate = vi.fn();
    const focus = vi.fn().mockResolvedValue(undefined);
    const client: FakeClient = { url: 'https://avash.test/dashboard', focus, navigate };

    const { listeners } = loadServiceWorker({ clientList: [client] });
    await fireClick(listeners, '/dashboard');

    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });
});
