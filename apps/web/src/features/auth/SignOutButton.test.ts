import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signOutMock = vi.fn();
let sessionStatus: 'authenticated' | 'anonymous' | 'loading' = 'authenticated';

vi.mock('./useSignOut', () => ({
  useSignOut: () => ({ error: null, signOut: signOutMock }),
}));

vi.mock('./SessionProvider', () => ({
  useSession: () => ({
    session: null,
    user: null,
    role: null,
    accessToken: null,
    status: sessionStatus,
  }),
}));

describe('SignOutButton', () => {
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
    signOutMock.mockReset();
    sessionStatus = 'authenticated';
  });

  async function render() {
    const { SignOutButton } = await import('./SignOutButton');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(SignOutButton));
    });
    return container;
  }

  test('renders nothing when signed out', async () => {
    sessionStatus = 'anonymous';
    const el = await render();
    expect(el.querySelector('button')).toBeNull();
  });

  test('renders the button when authenticated', async () => {
    signOutMock.mockResolvedValue({ ok: true });
    const el = await render();
    expect(el.querySelector('[data-testid="sign-out-button"]')).not.toBeNull();
  });

  test('clicking submits and calls signOut exactly once', async () => {
    signOutMock.mockResolvedValue({ ok: true });
    const el = await render();
    const form = el.querySelector('[data-testid="sign-out-form"]') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  test('the button is disabled while the call is in flight', async () => {
    let resolveSignOut: (value: { ok: boolean }) => void = () => {};
    signOutMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSignOut = resolve;
      })
    );
    const el = await render();
    const form = el.querySelector('[data-testid="sign-out-form"]') as HTMLFormElement;

    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const button = el.querySelector('[data-testid="sign-out-button"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await act(async () => {
      resolveSignOut({ ok: true });
    });
  });

  test('a { ok: false } resolution shows the generic message, not raw error text', async () => {
    signOutMock.mockResolvedValue({ ok: false });
    const el = await render();
    const form = el.querySelector('[data-testid="sign-out-form"]') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const errorEl = el.querySelector('[data-testid="sign-out-error"]');
    expect(errorEl?.textContent).toBe('Unable to sign out. Please try again.');
  });
});
