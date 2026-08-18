import { useState } from 'react';
import { useListQuery } from '../../hooks/useListQuery';
import { useSession } from '../auth/SessionProvider';
import { useAnnouncements } from './useAnnouncements';
import { useDeleteAnnouncement } from './useDeleteAnnouncement';

/** `GET /api/announcements` has no declared sortable columns — the route always orders `created_at desc`. */
const SORTABLE: readonly string[] = [];

/**
 * The moderator/admin view of announcements they can act on
 * (`GET /api/announcements?scope=manage`): their own rows, or every row
 * for an admin, expired ones included. Unlike `AnnouncementList`, this
 * takes no location — a management list that hides your own announcement
 * because you moved out of its radius would be useless for managing it.
 *
 * Deletion asks for confirmation first: it is irreversible, and the row
 * being deleted is one every targeted citizen may already be relying on.
 */
export function AnnouncementManageList() {
  const { accessToken } = useSession();
  const { query, setPage } = useListQuery(SORTABLE);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const announcements = useAnnouncements(
    accessToken,
    accessToken ? { scope: 'manage', page: query.page, pageSize: query.pageSize } : null
  );
  const remove = useDeleteAnnouncement();

  const items = announcements?.data?.items ?? [];
  const page = announcements?.data?.page;
  const isRefreshing = Boolean(announcements?.isFetching) && !announcements?.isLoading;

  const handleDelete = (id: string) => {
    if (!accessToken || !id) {
      return;
    }
    remove?.mutate?.({ id, accessToken }, { onSettled: () => setConfirmingId(null) });
  };

  return (
    <section className="card" data-testid="announcement-manage-list">
      <div className="page__title-row">
        <h2 className="page__title">Your announcements</h2>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => announcements?.refetch?.()}
          disabled={isRefreshing}
          data-testid="announcement-manage-refresh"
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {remove?.isError ? (
        <p className="field__error" data-testid="announcement-manage-delete-error">
          {remove.error?.message ?? 'Unable to delete that announcement right now.'}
        </p>
      ) : null}

      {announcements?.isLoading ? (
        <p data-testid="announcement-manage-loading">Loading…</p>
      ) : announcements?.isError ? (
        <p className="field__error" data-testid="announcement-manage-error">
          Unable to load your announcements right now.
        </p>
      ) : items.length === 0 ? (
        <p className="status-panel__item" data-testid="announcement-manage-empty">
          You haven't published any announcements yet.
        </p>
      ) : (
        <>
          <ul className="announcement-list" data-testid="announcement-manage-items">
            {items.map((item) => {
              const expiresAt = item?.expiresAt ? new Date(item.expiresAt) : null;
              const hasExpired = expiresAt !== null && expiresAt.getTime() <= Date.now();
              return (
                <li key={item?.id} className="card" data-testid="announcement-manage-item">
                  <h3>{item?.title ?? '(untitled)'}</h3>
                  <p>{item?.body ?? ''}</p>
                  <p className="field__label">
                    {hasExpired ? 'Expired' : 'Expires'} {expiresAt ? expiresAt.toLocaleString() : '—'} · radius{' '}
                    {item?.radiusM ?? '—'} m ·{' '}
                    {(item?.targetRoles?.length ?? 0) === 0 ? 'all roles' : item.targetRoles.join(', ')}
                  </p>

                  {confirmingId === item?.id ? (
                    <div className="field">
                      <p className="field__error" data-testid="announcement-delete-confirm-prompt">
                        Delete this announcement? This cannot be undone.
                      </p>
                      <button
                        type="button"
                        className="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={Boolean(remove?.isPending)}
                        data-testid="announcement-delete-confirm"
                      >
                        {remove?.isPending ? 'Deleting…' : 'Yes, delete it'}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => setConfirmingId(null)}
                        disabled={Boolean(remove?.isPending)}
                        data-testid="announcement-delete-cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setConfirmingId(item?.id ?? null)}
                      data-testid="announcement-delete"
                    >
                      Delete
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="pagination">
            <button
              type="button"
              className="button button--secondary"
              disabled={query.page <= 1}
              onClick={() => setPage(query.page - 1)}
              data-testid="announcement-manage-prev"
            >
              Prev
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={!page?.hasNext}
              onClick={() => setPage(query.page + 1)}
              data-testid="announcement-manage-next"
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
