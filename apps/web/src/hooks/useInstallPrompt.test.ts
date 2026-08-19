import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useInstallPrompt, type UseInstallPromptResult } from './useInstallPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let latest: UseInstallPromptResult;

function Probe() {
  latest = useInstallPrompt();
  return null;
}

async function render() {
  await act(async () => {
    root.render(createElement(Probe));
  });
}

/**
 * A stand-in for Chromium's non-standard `BeforeInstallPromptEvent`. The
 * real one is a plain Event with `prompt()` and `userChoice` bolted on,
 * which is exactly what this builds.
 */
function makeInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

let standaloneMatches = false;

beforeEach(() => {
  standaloneMatches = false;
  // jsdom has no matchMedia at all.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('standalone') ? standaloneMatches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete (navigator as { standalone?: boolean }).standalone;
});

describe('useInstallPrompt', () => {
  test('starts idle when the browser has not offered an install', async () => {
    await render();
    expect(latest.status).toBe('idle');
  });

  test('goes available when beforeinstallprompt fires, and suppresses the browser mini-infobar', async () => {
    await render();
    const event = makeInstallEvent();
    const preventDefault = vi.spyOn(event, 'preventDefault');

    await act(async () => {
      window.dispatchEvent(event);
    });

    expect(latest.status).toBe('available');
    // Without preventDefault, Chromium shows its own install bar competing
    // with this app's control.
    expect(preventDefault).toHaveBeenCalled();
  });

  test('promptInstall shows the held prompt and reports acceptance', async () => {
    await render();
    const event = makeInstallEvent('accepted');
    await act(async () => {
      window.dispatchEvent(event);
    });

    await act(async () => {
      await latest.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe('installed');
  });

  test('a dismissed prompt leaves the app uninstalled and does not re-arm', async () => {
    await render();
    const event = makeInstallEvent('dismissed');
    await act(async () => {
      window.dispatchEvent(event);
    });

    await act(async () => {
      await latest.promptInstall();
    });
    expect(latest.status).toBe('dismissed');

    // The browser discards the event after prompt(); calling again must
    // not re-invoke it, which would reject and could loop the UI.
    await act(async () => {
      await latest.promptInstall();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  test('reports installed immediately when already running standalone, without waiting for any event', async () => {
    standaloneMatches = true;
    await render();
    expect(latest.status).toBe('installed');
  });

  test('reports installed on iOS, which signals standalone via navigator.standalone rather than display-mode', async () => {
    (navigator as { standalone?: boolean }).standalone = true;
    await render();
    expect(latest.status).toBe('installed');
  });

  test('an install completed through the browser menu still flips the status', async () => {
    await render();
    await act(async () => {
      window.dispatchEvent(new Event('beforeinstallprompt'));
    });
    expect(latest.status).toBe('available');

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(latest.status).toBe('installed');
  });

  test('promptInstall is a no-op when nothing has been offered', async () => {
    await render();
    await act(async () => {
      await latest.promptInstall();
    });
    expect(latest.status).toBe('idle');
  });
});
