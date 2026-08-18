import { useState, type FormEvent } from 'react';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useSession } from '../auth/SessionProvider';
import { useSubscribeAlert } from './useSubscribeAlert';
import { useAlertSubscriptions } from './useAlertSubscriptions';
import { SubmitButton } from '../../components/SubmitButton';

/** Bounds mirror `alertSubscribeSchema` in packages/types/alerts.ts EXACTLY (100–20,000). */
const ALERT_RADIUS_MIN_M = 100;
const ALERT_RADIUS_MAX_M = 20_000;
/** Matches `alertSubscribeSchema`'s own `.default(2000)`. */
const ALERT_RADIUS_DEFAULT_M = 2000;

/** Fixed, generic message only — the browser's geolocation error is never rendered directly. */
const LOCATION_GENERIC_ERROR = 'Unable to determine your location. Please try again or check location permissions.';

/**
 * Proximity alert subscription form (feature 7 / `POST /api/alerts/subscribe`).
 * Uses the real `useGeolocation()` hook for the subscription point and
 * keeps the radius bound to the DB check constraint client-side so an
 * out-of-range value never reaches the network.
 *
 * A user may hold more than one geofence (e.g. home and work), so a
 * successful subscribe never permanently replaces this form with a
 * static "done" screen — it shows the real, persisted subscription
 * count (`useAlertSubscriptions`, read directly from Supabase via RLS)
 * alongside the form, which stays correct across a reload, unlike the
 * mutation's own `isSuccess` flag.
 */
export function AlertSubscribeForm() {
  const { accessToken, user } = useSession();
  const geolocation = useGeolocation();
  const subscribe = useSubscribeAlert();
  const existing = useAlertSubscriptions(user?.id ?? null);
  const [radiusM, setRadiusM] = useState(ALERT_RADIUS_DEFAULT_M);
  const [justSubscribed, setJustSubscribed] = useState(false);

  const locationRequested = geolocation?.status !== 'idle';
  const hasLocation = typeof geolocation?.lat === 'number' && typeof geolocation?.lng === 'number';
  const locationFailed = geolocation?.status === 'denied' || geolocation?.status === 'unavailable';
  const radiusEmpty = !Number.isFinite(radiusM);
  const radiusValid = !radiusEmpty && radiusM >= ALERT_RADIUS_MIN_M && radiusM <= ALERT_RADIUS_MAX_M;
  const isPending = Boolean(subscribe?.isPending);
  const canSubmit = Boolean(accessToken) && hasLocation && radiusValid && !isPending;

  const activeCount = existing?.data?.length ?? 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event?.preventDefault?.();
    if (!canSubmit || geolocation?.lat === null || geolocation?.lng === null || !accessToken) {
      return;
    }
    setJustSubscribed(false);
    subscribe?.mutate?.(
      {
        lat: geolocation.lat as number,
        lng: geolocation.lng as number,
        radiusM,
        active: true,
        accessToken,
      },
      { onSuccess: () => setJustSubscribed(true) }
    );
  };

  return (
    <div>
      {existing?.isLoading ? null : activeCount > 0 ? (
        <p className="status-panel__item" data-testid="alert-subscribe-status">
          You have {activeCount} active alert {activeCount === 1 ? 'subscription' : 'subscriptions'} — we'll notify
          you if dengue risk rises near {activeCount === 1 ? 'that location' : 'those locations'}.
        </p>
      ) : null}

      {justSubscribed ? (
        <div className="alert" data-testid="alert-subscribe-success">
          You're subscribed — we'll alert you if dengue risk rises near this location.
        </div>
      ) : null}

      <form className="form" onSubmit={handleSubmit} data-testid="alert-subscribe-form">
        <fieldset disabled={isPending}>
          <div className="field">
            <span className="field__label">Location</span>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => geolocation?.request?.()}
              disabled={isPending || geolocation?.status === 'requesting'}
              data-testid="alert-subscribe-locate"
            >
              {geolocation?.status === 'requesting' ? 'Locating…' : 'Use my location'}
            </button>

            {locationFailed ? (
              <p className="field__error" data-testid="alert-subscribe-location-error">
                {LOCATION_GENERIC_ERROR}
              </p>
            ) : !hasLocation && locationRequested === false ? (
              <p className="field__error" data-testid="alert-subscribe-location-hint">
                Set your location before subscribing.
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="alert-radius" className="field__label">
              Alert radius (meters)
            </label>
            <input
              id="alert-radius"
              type="number"
              min={ALERT_RADIUS_MIN_M}
              max={ALERT_RADIUS_MAX_M}
              value={Number.isNaN(radiusM) ? '' : radiusM}
              disabled={isPending}
              onChange={(event) => {
                const raw = event?.target?.value;
                setRadiusM(raw === '' || raw === undefined ? Number.NaN : Number(raw));
              }}
              data-testid="alert-radius-input"
            />
            {radiusEmpty ? (
              <p className="field__error" data-testid="alert-radius-error">
                Radius is required.
              </p>
            ) : !radiusValid ? (
              <p className="field__error" data-testid="alert-radius-error">
                Radius must be between {ALERT_RADIUS_MIN_M} and {ALERT_RADIUS_MAX_M} meters.
              </p>
            ) : null}
          </div>
        </fieldset>

        {subscribe?.isError ? (
          <p className="field__error" data-testid="alert-subscribe-error">
            {subscribe.error?.message ?? 'Something went wrong. Please try again.'}
          </p>
        ) : null}

        <SubmitButton
          pending={isPending}
          disabled={!canSubmit}
          pendingLabel="Subscribing…"
          data-testid="alert-subscribe-submit"
        >
          Subscribe to alerts
        </SubmitButton>
      </form>
    </div>
  );
}
