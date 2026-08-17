import { describe, test, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// Not React-Testing-Library — a minimal react-dom harness, the pattern
// docs/standards/testing.md permits for jsdom component/hook checks
// (see apps/web/src/features/map/useLeafletMap.test.ts).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Spinner', () => {
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

  test('renders role="status" with a visually-hidden label', async () => {
    const { Spinner } = await import('./Spinner');

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(createElement(Spinner, { label: 'Locating…' }));
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe('Locating…');
    expect(status?.querySelector('.visually-hidden')?.textContent).toBe('Locating…');
  });

  test('defaults to a generic "Loading…" label', async () => {
    const { Spinner } = await import('./Spinner');

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(createElement(Spinner));
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading…');
  });
});
