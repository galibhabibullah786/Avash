import { test, expect } from '@playwright/test';

/**
 * Installability and offline behaviour, against the real production build
 * in a real browser — the only place these can be checked. The unit tests
 * in `src/lib/sw.test.ts` drive the worker's handlers directly in a `vm`
 * sandbox, which proves the logic but says nothing about whether the
 * browser actually registers the worker, whether Workbox injected a
 * manifest into it, or whether the app meets the criteria Chrome requires
 * before it will offer "Install app" on Android.
 *
 * Chromium only. `beforeinstallprompt`, `display-mode` install criteria
 * and service-worker precaching behave differently or not at all in
 * Firefox, and asserting them there would be asserting a browser bug.
 */
test.describe('PWA installability', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Install criteria are Chromium-specific');

  test('serves a web app manifest meeting the Android install criteria', async ({ page }) => {
    await page.goto('/');

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const manifest = await response.json();

    // Exactly the set Chrome requires before it fires
    // `beforeinstallprompt`. A missing 512px icon or a `display` of
    // `browser` silently costs the app its install prompt, and therefore
    // costs iOS/iPadOS users Web Push entirely.
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);

    const sizes: string[] = (manifest.icons ?? []).map((icon: { sizes: string }) => icon?.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');

    // Maskable icons are what stop Android from rendering the icon inside
    // a white circle on the launcher.
    const purposes: string[] = (manifest.icons ?? []).map((icon: { purpose?: string }) => icon?.purpose ?? '');
    expect(purposes.some((purpose) => purpose.includes('maskable'))).toBe(true);
  });

  test('every icon the manifest advertises actually resolves', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await page.request.get(href!)).json();

    // A 404 here is invisible in the manifest itself and breaks the
    // install prompt with no console error worth noticing.
    for (const icon of manifest.icons ?? []) {
      const iconResponse = await page.request.get(icon.src);
      expect(iconResponse.status(), `icon ${icon.src}`).toBe(200);
    }
  });

  test('registers a service worker at boot, not only after opting into push', async ({ page }) => {
    await page.goto('/');

    // Boot registration is what makes the app installable on a first
    // visit. Registering lazily (on push opt-in) meant no install prompt
    // for anyone who had not already enabled notifications — see the
    // comment in src/main.tsx.
    const scriptUrl = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.scriptURL ?? null;
    });

    expect(scriptUrl).toContain('/sw.js');
  });

  test('the built worker carries an injected precache manifest covering the app shell', async ({ page }) => {
    await page.goto('/');
    const source = await (await page.request.get('/sw.js')).text();

    // `self.__WB_MANIFEST` must have been SUBSTITUTED by
    // vite-plugin-pwa's injectManifest, not left as a literal — if the
    // plugin ever stops running, the worker still installs and still
    // handles push, and the only visible symptom is that offline support
    // quietly does nothing.
    expect(source).not.toContain('__WB_MANIFEST');
    expect(source).toContain('index.html');
    expect(source).toMatch(/revision/);
  });

  test('precaches the app shell into a versioned cache', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const precacheName = names.find((name) => name.startsWith('avash-precache-'));
      if (!precacheName) return null;
      const cache = await caches.open(precacheName);
      const keys = await cache.keys();
      return keys.map((request) => new URL(request.url).pathname);
    });

    expect(cached, 'no avash-precache-* cache was created').not.toBeNull();
    expect(cached).toContain('/index.html');
    expect(cached).toContain('/offline.html');
    // The hashed entry chunk — proof the injected manifest, not just the
    // two hand-listed pages, made it into the cache.
    expect(cached!.some((path) => path.startsWith('/assets/'))).toBe(true);
  });

  test('leaves API requests out of the cache entirely', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);

    const apiEntries = await page.evaluate(async () => {
      const names = await caches.keys();
      const found: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).pathname.startsWith('/api/')) found.push(request.url);
        }
      }
      return found;
    });

    // Serving a cached /api/ response would show stale outbreak risk data,
    // which for this application is worse than showing an error.
    expect(apiEntries).toEqual([]);
  });
});
