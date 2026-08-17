import type { ReactNode } from 'react';
import type { PageMeta } from '@avash/types';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  page: PageMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Omitted entirely for a source that cannot sort (baseline fact 3). */
  onSortChange?: (key: string) => void;
  emptyMessage?: string;
  /** Shown under the table when a source cannot filter/sort/count at all. */
  note?: string;
  'data-testid'?: string;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/**
 * The shared paginated-table primitive (B-T06). Transport-agnostic — it
 * only knows about `PageMeta`, so the Hono-query-param transport and the
 * PostgREST `.range()` transport are indistinguishable from here (baseline
 * fact 2).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  page,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  emptyMessage = 'No results.',
  note,
  'data-testid': dataTestId,
}: DataTableProps<T>) {
  const pageSizeOptions = PAGE_SIZE_OPTIONS.includes(page.pageSize as (typeof PAGE_SIZE_OPTIONS)[number])
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, page.pageSize].sort((a, b) => a - b);

  const start = rows.length > 0 ? (page.page - 1) * page.pageSize + 1 : 0;
  const end = rows.length > 0 ? start + rows.length - 1 : 0;

  return (
    <div className="data-table" data-testid={dataTestId}>
      {rows.length === 0 ? (
        <p data-testid={dataTestId ? `${dataTestId}-empty` : undefined}>{emptyMessage}</p>
      ) : (
        <table className="table" data-testid={dataTestId ? `${dataTestId}-table` : undefined}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>
                  {column.sortable ? (
                    <button
                      type="button"
                      className="data-table__sort-button"
                      aria-sort={
                        page.sort === column.key
                          ? page.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      onClick={() => onSortChange?.(column.key)}
                      data-testid={`sort-${column.key}`}
                    >
                      {column.header}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {note ? <p className="field__label" data-testid={dataTestId ? `${dataTestId}-note` : undefined}>{note}</p> : null}

      <div className="data-table__footer">
        <span className="data-table__range" data-testid={dataTestId ? `${dataTestId}-range` : undefined}>
          {rows.length === 0
            ? emptyMessage
            : page.total === null
              ? `Showing ${start}–${end}`
              : `Showing ${start}–${end} of ${page.total}`}
        </span>

        <span>
          <button
            type="button"
            className="button button--secondary"
            disabled={page.page <= 1}
            onClick={() => onPageChange(page.page - 1)}
            data-testid={dataTestId ? `${dataTestId}-prev` : undefined}
          >
            Previous
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            disabled={!page.hasNext}
            onClick={() => onPageChange(page.page + 1)}
            data-testid={dataTestId ? `${dataTestId}-next` : undefined}
          >
            Next
          </button>
        </span>

        <label>
          <span className="field__label">Per page</span>{' '}
          <select
            className="data-table__page-size"
            value={page.pageSize}
            onChange={(event) => onPageSizeChange(Number(event?.target?.value))}
            data-testid={dataTestId ? `${dataTestId}-page-size` : undefined}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
