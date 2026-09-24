import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Status = 'unsupported' | 'unconfigured' | 'checking' | 'idle' | 'requesting' | 'denied' | 'subscribed' | 'error';

let pushStatus: Status = 'idle';
let accessToken: string | null = 'token-1';
const subscribeMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../auth/SessionProvider', () => ({
  useSession: () => ({
    session: null,
    user: { id: 'user-1', email: 'user@example.com' },
    role: 'citizen',
    accessToken,
    status: 'authenticated',
  }),
}));

vi.mock('../../hooks/usePushSubscription', () => ({
  usePushSubscription: () => ({ status: pushStatus, subscribe: subscribeMock }),
}));

describe('PushNotificationToggle', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    pushStatus = 'idle';
    accessToken = 'token-1';
    subscribeMock.mockClear();
  });

  async function render() {
    const { PushNotificationToggle } = await import('./PushNotificationToggle');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(PushNotificationToggle));
    });
    return container;
  }

  test('offers a button to enable notifications — without one, push_subscriptions is never populated', async () => {
    const el = await render();
    const button = el.querySelector('[data-testid="push-toggle-enable"]') as HTMLButtonElement;

    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
  });

  test('permission is requested from a click, never on mount', async () => {
    const el = await render();
    // Notification.requestPermission() outside a user gesture is refused
    // by most browsers, so an effect-driven version would silently fail.
    expect(subscribeMock).not.toHaveBeenCalled();

    const button = el.querySelector('[data-testid="push-toggle-enable"]') as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  test('reports success once the browser subscription is registered', async () => {
    pushStatus = 'subscribed';
    const el = await render();

    expect(el.querySelector('[data-testid="push-toggle-subscribed"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="push-toggle-enable"]')).toBeNull();
  });

  test('a blocked permission explains where to unblock it rather than just failing', async () => {
    pushStatus = 'denied';
    const el = await render();

    expect(el.querySelector('[data-testid="push-toggle-denied"]')?.textContent).toContain('site settings');
  });

  test('an unsupported browser says alerts still appear in-app, instead of showing a dead button', async () => {
    pushStatus = 'unsupported';
    const el = await render();

    expect(el.querySelector('[data-testid="push-toggle-unsupported"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="push-toggle-enable"]')).toBeNull();
  });

  test('while the real state is still being resolved, no Enable button is shown', async () => {
    // Flashing "Enable push notifications" at a browser that turns out
    // to be subscribed is exactly what made this control look broken.
    pushStatus = 'checking';
    const el = await render();

    expect(el.querySelector('[data-testid="push-toggle-checking"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="push-toggle-enable"]')).toBeNull();
  });

  test('a deployment with no VAPID key says so, instead of a generic "try again"', async () => {
    pushStatus = 'unconfigured';
    const el = await render();

    expect(el.querySelector('[data-testid="push-toggle-unconfigured"]')).not.toBeNull();
    // Nothing the user can do here, so no button to press.
    expect(el.querySelector('[data-testid="push-toggle-enable"]')).toBeNull();
  });

  test('an unsupported browser explains the iOS Home Screen requirement', async () => {
    pushStatus = 'unsupported';
    const el = await render();

    expect(el.querySelector('[data-testid="push-toggle-unsupported"]')?.textContent).toContain('Home Screen');
  });

  test('an error is surfaced, not swallowed into a silently-unchanged button', async () => {
    pushStatus = 'error';
    const el = await render();

    expect(el.querySelector('[data-testid="push-toggle-error"]')).not.toBeNull();
    // Still offers a retry.
    expect(el.querySelector('[data-testid="push-toggle-enable"]')).not.toBeNull();
  });

  test('the button is disabled while the permission prompt is open', async () => {
    pushStatus = 'requesting';
    const el = await render();

    const button = el.querySelector('[data-testid="push-toggle-enable"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Enabling…');
  });

  test('the button is disabled without a session — the registration POST is authenticated', async () => {
    accessToken = null;
    const el = await render();

    expect((el.querySelector('[data-testid="push-toggle-enable"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
