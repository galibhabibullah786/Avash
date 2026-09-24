import { describe, test, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DataTable, type DataTableColumn } from './DataTable';
import type { PageMeta } from '@avash/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.name },
];

const basePage: PageMeta = { page: 2, pageSize: 25, total: 312, hasNext: true, sort: null, dir: 'asc' };
const rows: Row[] = [{ id: '1', name: 'Alice' }];

describe('DataTable', () => {
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

  function renderTable(props: Record<string, unknown>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(createElement(DataTable, props as never));
    });
  }

  test('aria-sort flips on header click', () => {
    const onSortChange = vi.fn();
    renderTable({
      columns,
      rows,
      rowKey: (row: Row) => row.id,
      page: basePage,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      onSortChange,
      'data-testid': 'test-table',
    });

    const sortButton = container?.querySelector('[data-testid="sort-name"]') as HTMLButtonElement;
    expect(sortButton.getAttribute('aria-sort')).toBe('none');

    act(() => {
      sortButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSortChange).toHaveBeenCalledWith('name');

    act(() => {
      root?.render(
        createElement(DataTable, {
          columns,
          rows,
          rowKey: (row: Row) => row.id,
          page: { ...basePage, sort: 'name', dir: 'asc' },
          onPageChange: vi.fn(),
          onPageSizeChange: vi.fn(),
          onSortChange,
          'data-testid': 'test-table',
        } as never)
      );
    });

    const updatedButton = container?.querySelector('[data-testid="sort-name"]') as HTMLButtonElement;
    expect(updatedButton.getAttribute('aria-sort')).toBe('ascending');
  });

  test('the range label omits the total when page.total is null', () => {
    renderTable({
      columns,
      rows,
      rowKey: (row: Row) => row.id,
      page: { ...basePage, total: null },
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      'data-testid': 'test-table',
    });

    const range = container?.querySelector('[data-testid="test-table-range"]');
    expect(range?.textContent).toBe('Showing 26–26');
    expect(range?.textContent).not.toContain('of');
  });

  test('the range label includes the total when page.total is not null', () => {
    renderTable({
      columns,
      rows,
      rowKey: (row: Row) => row.id,
      page: basePage,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      'data-testid': 'test-table',
    });

    const range = container?.querySelector('[data-testid="test-table-range"]');
    expect(range?.textContent).toBe('Showing 26–26 of 312');
  });

  test('prev is disabled on page 1 and next is disabled when hasNext is false', () => {
    renderTable({
      columns,
      rows,
      rowKey: (row: Row) => row.id,
      page: { ...basePage, page: 1, hasNext: false },
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      'data-testid': 'test-table',
    });

    const prev = container?.querySelector('[data-testid="test-table-prev"]') as HTMLButtonElement;
    const next = container?.querySelector('[data-testid="test-table-next"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);
  });

  test('each row carries a data-testid derived from the table testid', () => {
    renderTable({
      columns,
      rows: [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
      rowKey: (row: Row) => row.id,
      page: basePage,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      'data-testid': 'test-table',
    });

    const dataRows = container?.querySelectorAll('[data-testid="test-table-row"]');
    expect(dataRows?.length).toBe(2);
  });
});
