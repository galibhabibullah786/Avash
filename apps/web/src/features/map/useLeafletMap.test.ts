import { describe, test, expect, vi, afterEach } from 'vitest';
import { createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// react-dom's act() warns unless this global is set — normally done by
// React Testing Library's setup, which this repo deliberately does not use
// (docs/standards/testing.md bans RTL component-tree tests). This harness
// still needs act() to flush the effect that creates/tears down the map.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const removeMock = vi.fn();
const addToMock = vi.fn();
const mapInstance = { remove: removeMock };

vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => mapInstance),
    tileLayer: vi.fn(() => ({ addTo: addToMock })),
    Icon: {
      Default: Object.assign(function () {}, {
        prototype: {},
        mergeOptions: vi.fn(),
      }),
    },
  },
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('leaflet/dist/images/marker-icon-2x.png', () => ({ default: '' }));
vi.mock('leaflet/dist/images/marker-icon.png', () => ({ default: '' }));
vi.mock('leaflet/dist/images/marker-shadow.png', () => ({ default: '' }));

// Not React-Testing-Library — a minimal react-dom harness, permitted for
// hook logic per docs/standards/testing.md's jsdom scope. Verifies the
// effect's cleanup calls map.remove() (StrictMode double-mount safety).
describe('useLeafletMap', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let unmounted = false;

  afterEach(() => {
    if (root && !unmounted) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    unmounted = false;
    vi.clearAllMocks();
  });

  test('creates a map with a tile layer and calls remove() on unmount', async () => {
    const { useLeafletMap } = await import('./useLeafletMap');

    function Harness() {
      const ref = useRef<HTMLDivElement | null>(null);
      useLeafletMap(ref);
      return createElement('div', { ref });
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(createElement(Harness));
    });

    expect(addToMock).toHaveBeenCalledTimes(1);
    expect(removeMock).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    unmounted = true;

    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});
