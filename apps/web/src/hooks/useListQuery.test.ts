import { describe, test, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { LIST_PAGE_SIZE_MAX } from '@avash/types';
import { useListQuery, type UseListQueryResult } from './useListQuery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SORTABLE = ['createdAt', 'status'] as const;

describe('useListQuery', () => {
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

  function mount(initialEntry: string): { latest: () => UseListQueryResult } {
    let latest: UseListQueryResult | undefined;

    function Harness() {
      latest = useListQuery(SORTABLE);
      return null;
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        createElement(MemoryRouter, { initialEntries: [initialEntry] }, createElement(Harness))
      );
    });

    return {
      latest: () => {
        if (!latest) throw new Error('hook did not render');
        return latest;
      },
    };
  }

  test('defaults page/pageSize/dir when no search params are present', () => {
    const { latest } = mount('/');
    expect(latest().query.page).toBe(1);
    expect(latest().query.pageSize).toBe(25);
    expect(latest().query.dir).toBe('asc');
    expect(latest().query.sort).toBeUndefined();
  });

  test('a ?pageSize=9999 URL clamps to LIST_PAGE_SIZE_MAX rather than resetting to the default', () => {
    const { latest } = mount('/?pageSize=9999');
    expect(latest().query.pageSize).toBe(LIST_PAGE_SIZE_MAX);
  });

  test('an unknown sort key falls back to defaults rather than throwing', () => {
    expect(() => mount('/?sort=not-a-real-column')).not.toThrow();
    const { latest } = mount('/?sort=not-a-real-column');
    expect(latest().query.sort).toBeUndefined();
    expect(latest().query.page).toBe(1);
  });

  test('toggleSort updates the URL search params: new column starts ascending', () => {
    const { latest } = mount('/');

    act(() => {
      latest().toggleSort('createdAt');
    });

    expect(latest().query.sort).toBe('createdAt');
    expect(latest().query.dir).toBe('asc');
  });

  test('toggleSort on the already-active ascending column flips to descending', () => {
    const { latest } = mount('/?sort=createdAt&dir=asc');

    act(() => {
      latest().toggleSort('createdAt');
    });

    expect(latest().query.sort).toBe('createdAt');
    expect(latest().query.dir).toBe('desc');
  });

  test('setPage updates the URL search params', () => {
    const { latest } = mount('/');

    act(() => {
      latest().setPage(3);
    });

    expect(latest().query.page).toBe(3);
  });
});
