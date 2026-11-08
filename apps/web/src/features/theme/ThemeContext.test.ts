import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider, useTheme, ThemeToggle } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function TestComponent() {
  const { theme, toggleTheme } = useTheme();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'current-theme' }, theme),
    createElement('button', { 'data-testid': 'toggle-btn', onClick: toggleTheme }, 'Toggle')
  );
}

describe('Theme Feature', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

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

  test('defaults to light theme and sets data-theme attribute', () => {
    act(() => {
      root?.render(createElement(ThemeProvider, null, createElement(TestComponent)));
    });

    const themeSpan = container?.querySelector('[data-testid="current-theme"]');
    expect(themeSpan?.textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('toggles theme to dark and persists to localStorage', () => {
    act(() => {
      root?.render(createElement(ThemeProvider, null, createElement(TestComponent)));
    });

    const btn = container?.querySelector('[data-testid="toggle-btn"]') as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const themeSpan = container?.querySelector('[data-testid="current-theme"]');
    expect(themeSpan?.textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('avash-theme')).toBe('dark');
  });

  test('ThemeToggle component renders with appropriate accessibility attributes', () => {
    act(() => {
      root?.render(createElement(ThemeProvider, null, createElement(ThemeToggle)));
    });

    const toggleBtn = container?.querySelector('[data-testid="theme-toggle-btn"]') as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.getAttribute('aria-label')).toBe('ডার্ক মোড চালু করুন');
  });
});
