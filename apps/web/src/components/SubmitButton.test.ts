import { describe, test, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SubmitButton } from './SubmitButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SubmitButton', () => {
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
  });

  function render(props: Record<string, unknown>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(SubmitButton, props as never));
    });
    return container.querySelector('button') as HTMLButtonElement;
  }

  test('is enabled and shows children when not pending', () => {
    const button = render({ pending: false, children: 'Sign in' });
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(button.textContent).toBe('Sign in');
  });

  test('is disabled and aria-busy="true" while pending', () => {
    const button = render({ pending: true, children: 'Sign in', pendingLabel: 'Signing in…' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  test('the accessible name is the pendingLabel when one is given', () => {
    const button = render({ pending: true, children: 'Sign in', pendingLabel: 'Signing in…' });
    expect(button.textContent).toBe('Signing in…');
  });

  test('falls back to children as the pending label when none is given', () => {
    const button = render({ pending: true, children: 'Sign in' });
    expect(button.textContent).toBe('Sign in');
  });

  test('is disabled when disabled is true even while not pending', () => {
    const button = render({ pending: false, disabled: true, children: 'Sign in' });
    expect(button.disabled).toBe(true);
  });
});
