import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement, useState, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { PasswordInput } from './PasswordInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PasswordInput', () => {
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
    vi.useRealTimers();
  });

  function Harness() {
    const [value, setValue] = useState('hunter2');
    return createElement(PasswordInput, {
      id: 'test-password',
      value,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
      autoComplete: 'current-password',
      'data-testid': 'test-password',
    });
  }

  test('starts masked, and the toggle flips type + aria-pressed, preserving the value', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(createElement(Harness));
    });

    const input = container.querySelector('input') as HTMLInputElement;
    const toggle = container.querySelector('button') as HTMLButtonElement;

    expect(input.type).toBe('password');
    expect(input.value).toBe('hunter2');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Show password');

    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(input.type).toBe('text');
    expect(input.value).toBe('hunter2');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Hide password');

    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(input.type).toBe('password');
    expect(input.value).toBe('hunter2');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});
