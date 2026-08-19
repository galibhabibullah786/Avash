import { useEffect, useRef } from 'react';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useListQuery } from '../../hooks/useListQuery';
import { useSession } from '../auth/SessionProvider';
import { useAnnouncements } from './useAnnouncements';
import { useAnnouncement } from './useAnnouncement';

/** `GET /api/announcements` has no declared sortable columns (decision B, read-time targeting). */
const SORTABLE: readonly string[] = [];

export interface AnnouncementListProps {
  /**
   * The `?announcement=<id>` a deep-linked push notification lands with
   * (see `Dashboard.tsx`, `sw.js`'s `notificationclick`). Resolved via
   * `useAnnouncement` — independent of geolocation and of which page of
   * the feed below it would otherwise be on — and rendered as a pinned
   * card above the normal feed.
   */
  highlightedAnnouncementId?: string | null;
}

/**
 * In-app announcement feed (`GET /api/announcements`, decision H —
 * authenticated only, takes a caller-supplied point). Location is
 * requested only on an explicit click, matching `useReportLocation.ts`'s
 * pattern elsewhere in this app, so the query stays `null` — and the
 * fetch never fires — until the visitor opts in.
 */
export function AnnouncementList({ highlightedAnnouncementId = null }: AnnouncementListProps = {}) {
  const { accessToken } = useSession();
  const geolocation = useGeolocation();
  const { query, setPage } = useListQuery(SORTABLE);

  const highlighted = useAnnouncement(accessToken, highlightedAnnouncementId);
  const highlightedItem = highlighted?.isSuccess ? highlighted.data : null;

  const highlightRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!highlightedItem || !highlightRef.current) {
      return;
    }
    // A missing/unauthorized/errored id renders the normal dashboard
    // silently — this effect only ever runs once a real announcement has
    // resolved, never on a stale/broken link.
    const prefersReducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')?.matches
        : false;
    if (!prefersReducedMotion) {
      highlightRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [highlightedItem]);

  const hasLocation = typeof geolocation?.lat === 'number' && typeof geolocation?.lng === 'number';
  const locationFailed = geolocation?.status === 'denied' || geolocation?.status === 'unavailable';

  const announcementsQuery = hasLocation
    ? {
        page: query.page,
        pageSize: query.pageSize,
        lat: geolocation.lat as number,
        lng: geolocation.lng as number,
      }
    : null;

  const announcements = useAnnouncements(accessToken, announcementsQuery);
  const items = announcements?.data?.items ?? [];
  const page = announcements?.data?.page;
  const isRefreshing = Boolean(announcements?.isFetching) && !announcements?.isLoading;

  return (
    <section className="card" data-testid="announcement-list">
      {highlightedItem ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, marginBottom: 'var(--space-3)' }}>
          <li
            ref={highlightRef}
            className="card"
            data-testid="announcement-highlighted"
            data-highlighted="true"
            style={{ border: '2px solid var(--color-warning)' }}
          >
            <h3>{highlightedItem.title}</h3>
            <p>{highlightedItem.body}</p>
            <p className="field__label">
              Expires {highlightedItem.expiresAt ? new Date(highlightedItem.expiresAt).toLocaleString() : '—'}
            </p>
          </li>
        </ul>
      ) : null}

      <div className="page__title-row">
        <h2 className="page__title">Local announcements</h2>
        {hasLocation ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => announcements?.refetch?.()}
            disabled={isRefreshing}
            data-testid="announcement-list-refresh"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {!hasLocation ? (
        <div className="field">
          <p className="page__description">
            Share your location to see announcements relevant to your area.
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => geolocation?.request?.()}
            disabled={geolocation?.status === 'requesting'}
            data-testid="announcement-list-locate"
          >
            {geolocation?.status === 'requesting' ? 'Locating…' : 'Show announcements near me'}
          </button>
          {locationFailed ? (
            <p className="field__error" data-testid="announcement-list-location-error">
              Unable to determine your location right now.
            </p>
          ) : null}
        </div>
      ) : announcements?.isLoading ? (
        <p data-testid="announcement-list-loading">Loading…</p>
      ) : announcements?.isError ? (
        <p className="field__error" data-testid="announcement-list-error">
          Unable to load announcements right now.
        </p>
      ) : items.length === 0 ? (
        <p className="status-panel__item" data-testid="announcement-list-empty">
          No announcements for your area right now.
        </p>
      ) : (
        <>
          <ul className="announcement-list" data-testid="announcement-list-items">
            {items.map((item) => (
              <li key={item?.id} className="card" data-testid="announcement-item">
                <h3>{item?.title ?? '(untitled)'}</h3>
                <p>{item?.body ?? ''}</p>
                <p className="field__label">
                  Expires {item?.expiresAt ? new Date(item.expiresAt).toLocaleString() : '—'}
                </p>
              </li>
            ))}
          </ul>

          <div className="pagination">
            <button
              type="button"
              className="button button--secondary"
              disabled={query.page <= 1}
              onClick={() => setPage(query.page - 1)}
              data-testid="announcement-list-prev"
            >
              Prev
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={!page?.hasNext}
              onClick={() => setPage(query.page + 1)}
              data-testid="announcement-list-next"
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
