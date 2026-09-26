import { useGeolocation } from '../../hooks/useGeolocation';
import { useSession } from '../auth/SessionProvider';
import { useReportSubmissions } from './useReportSubmissions';

export function ReportSubmissionList() {
  const { accessToken } = useSession();
  const geolocation = useGeolocation();

  const hasLocation = typeof geolocation?.lat === 'number' && typeof geolocation?.lng === 'number';
  const locationFailed = geolocation?.status === 'denied' || geolocation?.status === 'unavailable';

  const query = hasLocation
    ? {
        lat: geolocation.lat as number,
        lng: geolocation.lng as number,
      }
    : null;

  const submissions = useReportSubmissions(accessToken, query);
  const items = submissions?.data?.items ?? [];
  const isRefreshing = Boolean(submissions?.isFetching) && !submissions?.isLoading;

  return (
    <section className="card" data-testid="report-submission-list" style={{ marginTop: '2rem' }}>
      <div className="page__title-row">
        <h2 className="page__title">Local report submissions</h2>
        {hasLocation ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => submissions?.refetch?.()}
            disabled={isRefreshing}
            data-testid="report-submission-list-refresh"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {!hasLocation ? (
        <div className="field">
          <p className="page__description">
            Share your location to see report submissions around your location.
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => geolocation?.request?.()}
            disabled={geolocation?.status === 'requesting'}
            data-testid="report-submission-list-locate"
          >
            {geolocation?.status === 'requesting' ? 'Locating…' : 'Show reports around my location'}
          </button>
          {locationFailed ? (
            <p className="field__error" data-testid="report-submission-list-location-error">
              Unable to determine your location right now.
            </p>
          ) : null}
        </div>
      ) : submissions?.isLoading ? (
        <p data-testid="report-submission-list-loading">Loading…</p>
      ) : submissions?.isError ? (
        <p className="field__error" data-testid="report-submission-list-error">
          Unable to load report submissions right now.
        </p>
      ) : items.length === 0 ? (
        <p className="status-panel__item" data-testid="report-submission-list-empty">
          No reports around your area right now.
        </p>
      ) : (
        <ul className="announcement-list" data-testid="report-submission-list-items">
          {items.map((item) => (
            <li key={item?.id} className="card" data-testid="report-submission-item">
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                {item.photoUrl && (
                  <img src={item.photoUrl} alt="Report site" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} />
                )}
                <div>
                  <h3 style={{ margin: 0, textTransform: 'capitalize' }}>{item.status} Report</h3>
                  <p style={{ margin: '0.5rem 0' }}>{item.description || 'No description provided.'}</p>
                  <p className="field__label">
                    Reported {new Date(item.createdAt).toLocaleString()} • {Math.round(item.distance * 111)}km away
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
