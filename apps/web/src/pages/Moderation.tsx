import { useState } from 'react';
import { SPAM_LIKELIHOOD_REJECT_THRESHOLD } from '@avash/types';
import { useSession } from '../features/auth/SessionProvider';
import {
  usePendingReports,
  type ModerationStatus,
  type PendingReportRow,
} from '../features/reports/usePendingReports';
import { useVerifyReport } from '../features/reports/useVerifyReport';
import { useListQuery } from '../hooks/useListQuery';
import { DataTable, type DataTableColumn } from '../components/DataTable';

const SORTABLE = ['createdAt', 'status'] as const;

const STATUS_OPTIONS: readonly ModerationStatus[] = ['pending', 'verified', 'rejected', 'resolved'];

export default function Moderation() {
  const { accessToken } = useSession();
  const [status, setStatus] = useState<ModerationStatus>('pending');
  const { query, setPage, setPageSize, toggleSort } = useListQuery(SORTABLE);
  const queue = usePendingReports({
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort as 'createdAt' | 'status' | undefined,
    dir: query.dir,
    status,
  });
  const verify = useVerifyReport();

  const handleDecision = (id: string, decision: 'verified' | 'rejected') => {
    if (!accessToken) return;
    verify?.mutate?.({ id, status: decision, accessToken });
  };

  const rows: PendingReportRow[] = queue?.data?.items ?? [];
  const page = queue?.data?.page ?? {
    page: query.page,
    pageSize: query.pageSize,
    total: null,
    hasNext: false,
    sort: query.sort ?? null,
    dir: query.dir,
  };

  const columns: DataTableColumn<PendingReportRow>[] = [
    {
      key: 'description',
      header: 'Description',
      render: (report) => <span data-testid="moderation-description">{report?.description ?? '(no description)'}</span>,
    },
    {
      key: 'status',
      header: 'Flag',
      sortable: true,
      render: (report) => {
        const spamLikelihood = report?.ai_validation?.spamLikelihood ?? 0;
        const flagged = spamLikelihood > SPAM_LIKELIHOOD_REJECT_THRESHOLD;
        return flagged ? <span className="badge badge--severe">Flagged for review</span> : null;
      },
    },
    {
      key: 'createdAt',
      header: 'Reported',
      sortable: true,
      render: (report) => (report?.created_at ? new Date(report.created_at).toLocaleString() : '—'),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (report) => (
        <>
          <button
            type="button"
            className="button"
            onClick={() => handleDecision(report.id, 'verified')}
            disabled={!accessToken || verify?.isPending}
            data-testid="verify-report"
          >
            Verify
          </button>{' '}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => handleDecision(report.id, 'rejected')}
            disabled={!accessToken || verify?.isPending}
            data-testid="reject-report"
          >
            Reject
          </button>
        </>
      ),
    },
  ];

  return (
    <main className="page page--wide">
      <h1 className="page__title">Moderation queue</h1>
      <p className="page__description">Citizen breeding-site reports awaiting review.</p>

      <div className="field">
        <label className="field__label" htmlFor="moderation-status">
          Status
        </label>
        <select
          id="moderation-status"
          value={status}
          onChange={(event) => {
            setStatus((event?.target?.value as ModerationStatus) ?? 'pending');
            setPage(1);
          }}
          data-testid="moderation-status-filter"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {queue?.isLoading ? (
        <p data-testid="moderation-loading">Loading…</p>
      ) : queue?.isError ? (
        <div className="alert alert--error" data-testid="moderation-error">
          Unable to load the moderation queue right now.
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          page={page}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          onSortChange={toggleSort}
          emptyMessage="No reports in this status."
          data-testid="moderation"
        />
      )}

      {verify?.isError ? (
        <p className="field__error" data-testid="verify-error">
          {verify.error?.message ?? 'Something went wrong. Please try again.'}
        </p>
      ) : null}
    </main>
  );
}
