import { useState } from 'react';
import { useGeolocation } from '../../../hooks/useGeolocation';
import { useSession } from '../../auth/SessionProvider';
import { useReportSubmissions } from '../useReportSubmissions';

export function ReportSubmissionList() {
  const { accessToken } = useSession();
  const geolocation = useGeolocation();
  const [filterNearMe, setFilterNearMe] = useState(false);

  const hasLocation = typeof geolocation?.lat === 'number' && typeof geolocation?.lng === 'number';
  const locationFailed = geolocation?.status === 'denied' || geolocation?.status === 'unavailable';
  const isLocating = geolocation?.status === 'requesting';

  const query =
    filterNearMe && hasLocation
      ? {
          lat: geolocation.lat as number,
          lng: geolocation.lng as number,
        }
      : null;

  const submissions = useReportSubmissions(accessToken, query);
  const items = submissions?.data?.items ?? [];
  const isRefreshing = Boolean(submissions?.isFetching) && !submissions?.isLoading;

  const handleToggleNearMe = () => {
    if (!filterNearMe) {
      setFilterNearMe(true);
      if (!hasLocation) {
        geolocation?.request?.();
      }
    } else {
      setFilterNearMe(false);
    }
  };

  return (
    <section className="card" data-testid="report-submission-list" style={{ marginTop: '2rem' }}>
      <div
        className="page__title-row"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}
      >
        <h2 className="page__title">নাগরিক রিপোর্টসমূহ</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className={`button ${!filterNearMe ? 'button--primary' : 'button--secondary'}`}
            onClick={() => setFilterNearMe(false)}
            data-testid="report-submission-filter-all"
            style={{ fontSize: '0.875rem', padding: '6px 12px' }}
          >
            সকল রিপোর্ট
          </button>
          <button
            type="button"
            className={`button ${filterNearMe ? 'button--primary' : 'button--secondary'}`}
            onClick={handleToggleNearMe}
            disabled={isLocating}
            data-testid="report-submission-list-locate"
            style={{ fontSize: '0.875rem', padding: '6px 12px' }}
          >
            {isLocating ? 'অবস্থান খোঁজা হচ্ছে…' : 'আমার আশপাশের রিপোর্ট'}
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => submissions?.refetch?.()}
            disabled={isRefreshing}
            data-testid="report-submission-list-refresh"
            style={{ fontSize: '0.875rem', padding: '6px 12px' }}
          >
            {isRefreshing ? 'হালনাগাদ হচ্ছে…' : 'হালনাগাদ'}
          </button>
        </div>
      </div>

      {filterNearMe && locationFailed ? (
        <p className="field__error" data-testid="report-submission-list-location-error" style={{ margin: '0.75rem 0' }}>
          এই মুহূর্তে আপনার অবস্থান শনাক্ত করা যায়নি। সমস্ত রিপোর্ট প্রদর্শিত হচ্ছে।
        </p>
      ) : null}

      {submissions?.isLoading ? (
        <p data-testid="report-submission-list-loading" style={{ marginTop: '1rem' }}>
          তথ্য লোড হচ্ছে…
        </p>
      ) : submissions?.isError ? (
        <p className="field__error" data-testid="report-submission-list-error" style={{ marginTop: '1rem' }}>
          এই মুহূর্তে রিপোর্ট তালিকা লোড করা যায়নি।
        </p>
      ) : items.length === 0 ? (
        <p className="status-panel__item" data-testid="report-submission-list-empty" style={{ marginTop: '1rem' }}>
          {filterNearMe
            ? 'আপনার এলাকায় এই মুহূর্তে কোনো অনুমোদিত নাগরিক রিপোর্ট নেই।'
            : 'এই মুহূর্তে কোনো অনুমোদিত নাগরিক রিপোর্ট নেই।'}
        </p>
      ) : (
        <ul className="announcement-list" data-testid="report-submission-list-items" style={{ marginTop: '1rem' }}>
          {items.map((item) => (
            <li key={item?.id} className="card" data-testid="report-submission-item">
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                {item.photoUrl && (
                  <img
                    src={item.photoUrl}
                    alt="রিপোর্ট প্রজনন ক্ষেত্র"
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }}
                  />
                )}
                <div>
                  <h3 style={{ margin: 0, textTransform: 'capitalize' }}>
                    নাগরিক রিপোর্ট (
                    {item.status === 'verified'
                      ? 'যাচাইকৃত'
                      : item.status === 'resolved'
                        ? 'সমাধানকৃত'
                        : item.status}
                    )
                  </h3>
                  <p style={{ margin: '0.5rem 0' }}>{item.description || 'কোনো বিবরণ দেওয়া হয়নি।'}</p>
                  <p className="field__label">
                    রিপোর্টের সময়: {new Date(item.createdAt).toLocaleString('bn-BD')}
                    {filterNearMe && typeof item.distance === 'number' && item.distance > 0
                      ? ` • ${Math.round(item.distance * 111)} কিমি দূরে`
                      : ''}
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
