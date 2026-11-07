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
        <h2 className="page__title">এলাকাভিত্তিক নাগরিক রিপোর্টসমূহ</h2>
        {hasLocation ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => submissions?.refetch?.()}
            disabled={isRefreshing}
            data-testid="report-submission-list-refresh"
          >
            {isRefreshing ? 'হালনাগাদ হচ্ছে…' : 'হালনাগাদ'}
          </button>
        ) : null}
      </div>

      {!hasLocation ? (
        <div className="field">
          <p className="page__description">
            আপনার আশপাশের নাগরিক রিপোর্ট দেখতে অবস্থান অনুমতি প্রদান করুন।
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => geolocation?.request?.()}
            disabled={geolocation?.status === 'requesting'}
            data-testid="report-submission-list-locate"
          >
            {geolocation?.status === 'requesting' ? 'অবস্থান খোঁজা হচ্ছে…' : 'আমার আশপাশের রিপোর্ট দেখুন'}
          </button>
          {locationFailed ? (
            <p className="field__error" data-testid="report-submission-list-location-error">
              এই মুহূর্তে আপনার অবস্থান শনাক্ত করা যায়নি।
            </p>
          ) : null}
        </div>
      ) : submissions?.isLoading ? (
        <p data-testid="report-submission-list-loading">তথ্য লোড হচ্ছে…</p>
      ) : submissions?.isError ? (
        <p className="field__error" data-testid="report-submission-list-error">
          এই মুহূর্তে রিপোর্ট তালিকা লোড করা যায়নি।
        </p>
      ) : items.length === 0 ? (
        <p className="status-panel__item" data-testid="report-submission-list-empty">
          আপনার এলাকায় এই মুহূর্তে কোনো নাগরিক রিপোর্ট নেই।
        </p>
      ) : (
        <ul className="announcement-list" data-testid="report-submission-list-items">
          {items.map((item) => (
            <li key={item?.id} className="card" data-testid="report-submission-item">
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                {item.photoUrl && (
                  <img src={item.photoUrl} alt="রিপোর্ট প্রজনন ক্ষেত্র" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} />
                )}
                <div>
                  <h3 style={{ margin: 0, textTransform: 'capitalize' }}>নাগরিক রিপোর্ট ({item.status})</h3>
                  <p style={{ margin: '0.5rem 0' }}>{item.description || 'কোনো বিবরণ দেওয়া হয়নি।'}</p>
                  <p className="field__label">
                    রিপোর্টের সময়: {new Date(item.createdAt).toLocaleString('bn-BD')} • {Math.round(item.distance * 111)} কিমি দূরে
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
