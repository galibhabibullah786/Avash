import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, test, expect, vi } from 'vitest';

/**
 * `apps/web/src/sw.js` is a raw script (not an ES module — it can't
 * import `packages/types`, per that file's own header comment), so it
 * can't be `import`ed directly. This loads its source into a sandboxed
 * `vm` context shaped like the service worker global scope (`self` IS the
 * global object, so `caches`/`fetch`/`clients` resolve as bare
 * identifiers exactly like they do in a real worker) and captures the
 * handlers it registers via `addEventListener` so they can be invoked
 * directly, the same technique this file needs for any future sw.js
 * behavior test.
 *
 * It reads the SOURCE, not `dist/sw.js`, so these tests do not require a
 * build — which is why `self.__WB_MANIFEST` has to be supplied by the
 * sandbox below: in a real worker vite-plugin-pwa's `injectManifest`
 * substitutes it at build time, and here it is left as a bare global
 * reference.
 */
const SW_SOURCE = readFileSync(path.resolve(__dirname, '../sw.js'), 'utf8');

interface FakeClient {
  url?: string;
  focus?: () => Promise<void> | void;
  navigate?: (url: string) => void;
  postMessage?: (message: unknown) => void;
}

function loadServiceWorker(overrides: {
  clientList?: FakeClient[];
  openWindow?: (url: string) => void;
  precacheManifest?: { url: string; revision: string | null }[];
  seedCache?: Record<string, unknown>;
  existingCacheNames?: string[];
  fetch?: (input: unknown) => Promise<unknown>;
} = {}) {
  const listeners: Record<string, (event: unknown) => unknown> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = overrides.openWindow ?? vi.fn();
  const cacheStore = new Map<string, unknown>(Object.entries(overrides.seedCache ?? {}));
  const openedCacheNames: string[] = [];
  const deletedCacheNames: string[] = [];
  const deletableCacheNames = overrides.existingCacheNames ?? [];
  const fetched: string[] = [];

  const sandbox: Record<string, unknown> = {
    addEventListener: (type: string, handler: (event: unknown) => unknown) => {
      listeners[type] = handler;
    },
    caches: {
      open: async (name: string) => {
        openedCacheNames.push(name);
        return {
          put: async (key: unknown, value: unknown) => {
            cacheStore.set(typeof key === 'string' ? key : String((key as { url?: string })?.url), value);
          },
        };
      },
      match: async (key: unknown) => {
        const path = typeof key === 'string' ? key : new URL((key as { url: string }).url).pathname;
        return cacheStore.get(path);
      },
      keys: async () => [...deletableCacheNames],
      delete: async (name: string) => {
        deletedCacheNames.push(name);
        return true;
      },
    },
    fetch: overrides.fetch ?? (async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as { url?: string })?.url;
      fetched.push(String(url));
      return { ok: true, url };
    }),
    skipWaiting: vi.fn(),
    clients: {
      matchAll: async () => overrides.clientList ?? [],
      openWindow,
      claim: vi.fn(),
    },
    registration: { showNotification, scope: 'https://avash.test/' },
    location: { origin: 'https://avash.test' },
    // Stands in for what vite-plugin-pwa's injectManifest substitutes at
    // build time. Base-RELATIVE urls, exactly as Workbox emits them —
    // absolute ones here would let a path-normalization regression in
    // sw.js pass unnoticed (see toScopedPath()).
    __WB_MANIFEST: overrides.precacheManifest ?? [
      { url: 'index.html', revision: 'shell-rev' },
      { url: 'assets/index-abc123.js', revision: null },
    ],
    console,
    URL,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox);

  return {
    listeners,
    showNotification,
    openWindow,
    cacheStore,
    openedCacheNames,
    deletedCacheNames,
    fetched,
  };
}

/** Drives an `install`/`activate` handler and waits for its waitUntil work. */
async function fireLifecycle(
  listeners: Record<string, (event: unknown) => unknown>,
  type: 'install' | 'activate',
) {
  const pending: unknown[] = [];
  listeners[type]?.({ waitUntil: (p: unknown) => pending.push(p) });
  await Promise.all(pending);
}

/**
 * Drives the `fetch` handler. Returns `{ handled: false }` when the
 * worker declined to call `respondWith` — which is a meaningful outcome,
 * not an absent one: it is how the worker says "let the network have
 * this untouched", and it is the required behaviour for every API call.
 */
async function fireFetch(
  listeners: Record<string, (event: unknown) => unknown>,
  request: { url: string; mode?: string; method?: string },
) {
  let responded: unknown;
  let handled = false;
  listeners.fetch?.({
    request: { method: 'GET', mode: 'no-cors', ...request },
    respondWith: (r: unknown) => {
      handled = true;
      responded = r;
    },
  });
  return { handled, response: await responded };
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

describe('sw.js app-shell precaching', () => {
  test('install precaches every __WB_MANIFEST entry, resolved to absolute paths, plus the offline page', async () => {
    const { listeners, cacheStore } = loadServiceWorker({
      precacheManifest: [
        { url: 'index.html', revision: 'r1' },
        { url: 'assets/index-abc123.js', revision: null },
      ],
    });

    await fireLifecycle(listeners, 'install');

    // Base-relative on the way in, absolute on the way out. A regression
    // that skipped normalization would populate the cache under
    // "index.html" and then never match a real request for "/index.html".
    expect([...cacheStore.keys()].sort()).toEqual([
      '/assets/index-abc123.js',
      '/index.html',
      '/offline.html',
    ]);
  });

  test('a precache entry that fails to fetch does not discard the rest of the shell', async () => {
    const { listeners, cacheStore } = loadServiceWorker({
      precacheManifest: [
        { url: 'index.html', revision: 'r1' },
        { url: 'assets/missing.js', revision: null },
      ],
      fetch: async (input: unknown) => {
        const url = String((input as { url?: string })?.url ?? input);
        if (url.includes('missing')) throw new Error('404');
        return { ok: true, url };
      },
    });

    await fireLifecycle(listeners, 'install');

    expect(cacheStore.has('/index.html')).toBe(true);
    expect(cacheStore.has('/assets/missing.js')).toBe(false);
  });

  test('the cache name changes when the build does, so a deploy cannot be pinned to a stale shell', async () => {
    const first = loadServiceWorker({ precacheManifest: [{ url: 'index.html', revision: 'r1' }] });
    const second = loadServiceWorker({ precacheManifest: [{ url: 'index.html', revision: 'r2' }] });

    await fireLifecycle(first.listeners, 'install');
    await fireLifecycle(second.listeners, 'install');

    expect(first.openedCacheNames[0]).not.toBe(second.openedCacheNames[0]);
  });

  test('activate deletes caches from previous builds', async () => {
    const { listeners, deletedCacheNames, openedCacheNames } = loadServiceWorker({
      existingCacheNames: ['avash-precache-stale', 'avash-offline-v1'],
    });

    await fireLifecycle(listeners, 'install');
    await fireLifecycle(listeners, 'activate');

    expect(deletedCacheNames).toContain('avash-precache-stale');
    expect(deletedCacheNames).toContain('avash-offline-v1');
    expect(deletedCacheNames).not.toContain(openedCacheNames[0]);
  });
});

describe('sw.js fetch routing', () => {
  test('a precached build asset is served from the cache without touching the network', async () => {
    const { listeners, fetched } = loadServiceWorker({
      precacheManifest: [{ url: 'assets/index-abc123.js', revision: null }],
      seedCache: { '/assets/index-abc123.js': { ok: true, cached: true } },
    });

    const { handled, response } = await fireFetch(listeners, {
      url: 'https://avash.test/assets/index-abc123.js',
    });

    expect(handled).toBe(true);
    expect(response).toEqual({ ok: true, cached: true });
    expect(fetched).not.toContain('https://avash.test/assets/index-abc123.js');
  });

  // The single most important assertion in this file. Serving a cached
  // /api/ response would show a user stale dengue risk data, which is
  // worse for this application than showing them an error.
  test('an API request is left entirely untouched', async () => {
    const { listeners } = loadServiceWorker({
      precacheManifest: [{ url: 'index.html', revision: 'r1' }],
    });

    const { handled } = await fireFetch(listeners, { url: 'https://avash.test/api/risk-map' });

    expect(handled).toBe(false);
  });

  test('a cross-origin request for a path that happens to be precached is left untouched', async () => {
    const { listeners } = loadServiceWorker({
      precacheManifest: [{ url: 'assets/index-abc123.js', revision: null }],
    });

    const { handled } = await fireFetch(listeners, {
      url: 'https://cdn.example.com/assets/index-abc123.js',
    });

    expect(handled).toBe(false);
  });

  test('a navigation the network cannot serve falls back to the precached app shell, not the offline page', async () => {
    const { listeners } = loadServiceWorker({
      precacheManifest: [{ url: 'index.html', revision: 'r1' }],
      seedCache: {
        '/index.html': { ok: true, shell: true },
        '/offline.html': { ok: true, offline: true },
      },
      fetch: async () => {
        throw new Error('offline');
      },
    });

    // A deep link the SPA router can render perfectly well once booted.
    const { handled, response } = await fireFetch(listeners, {
      url: 'https://avash.test/dashboard?announcement=abc',
      mode: 'navigate',
    });

    expect(handled).toBe(true);
    expect(response).toEqual({ ok: true, shell: true });
  });

  test('with no precached shell, a failed navigation still falls back to the offline page', async () => {
    const { listeners } = loadServiceWorker({
      precacheManifest: [],
      seedCache: { '/offline.html': { ok: true, offline: true } },
      fetch: async () => {
        throw new Error('offline');
      },
    });

    const { handled, response } = await fireFetch(listeners, {
      url: 'https://avash.test/dashboard',
      mode: 'navigate',
    });

    expect(handled).toBe(true);
    expect(response).toEqual({ ok: true, offline: true });
  });
});
