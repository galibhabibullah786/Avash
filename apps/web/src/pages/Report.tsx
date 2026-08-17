import { useState } from 'react';
import { REPORT_DESCRIPTION_MAX_CHARS } from '@avash/types';
import { env } from '../lib/env';
import { useSession } from '../features/auth/SessionProvider';
import { useReportLocation } from '../features/reports/useReportLocation';
import { TurnstileWidget } from '../features/reports/TurnstileWidget';
import { useSubmitBreedingReport } from '../features/reports/useSubmitBreedingReport';
import { Spinner } from '../components/Spinner';
import { SubmitButton } from '../components/SubmitButton';

export default function Report() {
  const { accessToken } = useSession();
  const location = useReportLocation();
  const submit = useSubmitBreedingReport();

  const [description, setDescription] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const hasLocation = typeof location?.lat === 'number' && typeof location?.lng === 'number';
  const canSubmit = hasLocation && Boolean(turnstileToken) && !submit?.isPending;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault?.();
    if (!hasLocation || !turnstileToken || location?.lat === null || location?.lng === null) {
      return;
    }

    submit?.mutate?.({
      lat: location.lat as number,
      lng: location.lng as number,
      description: description.trim() ? description.trim() : undefined,
      turnstileToken,
      accessToken: accessToken ?? undefined,
    });
  };

  if (submit?.isSuccess) {
    return (
      <main className="page">
        <h1 className="page__title">Report a breeding site</h1>
        <div className="alert" data-testid="report-success">
          Thank you — your report has been submitted and will be reviewed.
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="page__title">Report a breeding site</h1>
      <p className="page__description">
        Spotted standing water, a blocked drain, or another likely mosquito breeding site? Report it —
        no account required.
      </p>

      <form className="form" onSubmit={handleSubmit} data-testid="report-form">
        <fieldset className="report-form__fieldset" disabled={submit?.isPending}>
          <div className="field">
            <span className="field__label">Location</span>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => location?.requestDeviceLocation?.()}
              disabled={location?.requesting}
              data-testid="use-my-location"
            >
              {location?.requesting ? (
                <>
                  <Spinner label="Locating…" className="button__spinner" />
                  <span>Locating…</span>
                </>
              ) : (
                'Use my location'
              )}
            </button>

            {/* Announces both the in-progress request and its outcome —
                a denied permission must never leave the form silently
                stuck (feature 9). */}
            <p className="visually-hidden" role="status" aria-live="polite" data-testid="location-status">
              {location?.requesting ? 'Requesting your location…' : location?.permissionDenied ? 'Location unavailable.' : ''}
            </p>

            {location?.permissionDenied ? (
              <p className="field__error" data-testid="location-permission-denied">
                Location permission was denied. Enter coordinates manually below.
              </p>
            ) : null}

            <label htmlFor="report-lat" className="field__label">
              Latitude
            </label>
            <input
              id="report-lat"
              data-testid="report-lat"
              type="number"
              step="any"
              min={-90}
              max={90}
              value={location?.lat ?? ''}
              disabled={location?.requesting}
              onChange={(event) => {
                const value = event?.target?.value;
                location?.setManualLat?.(value === '' ? null : Number(value));
              }}
            />

            <label htmlFor="report-lng" className="field__label">
              Longitude
            </label>
            <input
              id="report-lng"
              data-testid="report-lng"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={location?.lng ?? ''}
              disabled={location?.requesting}
              onChange={(event) => {
                const value = event?.target?.value;
                location?.setManualLng?.(value === '' ? null : Number(value));
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="report-description" className="field__label">
              Description (optional)
            </label>
            <textarea
              id="report-description"
              data-testid="report-description"
              rows={4}
              maxLength={REPORT_DESCRIPTION_MAX_CHARS}
              value={description}
              onChange={(event) => setDescription(event?.target?.value ?? '')}
            />
            <span className="field__label" data-testid="description-counter">
              {description.length}/{REPORT_DESCRIPTION_MAX_CHARS}
            </span>
          </div>

          <div className="field">
            <TurnstileWidget siteKey={env.turnstileSiteKey} onVerify={setTurnstileToken} onExpire={() => setTurnstileToken(null)} />
          </div>
        </fieldset>

        {submit?.isError ? (
          <p className="field__error" data-testid="submit-error">
            {submit.error?.message ?? 'Something went wrong. Please try again.'}
          </p>
        ) : null}

        <SubmitButton pending={Boolean(submit?.isPending)} disabled={!canSubmit} pendingLabel="Submitting…" data-testid="submit-report">
          Submit report
        </SubmitButton>
      </form>
    </main>
  );
}
