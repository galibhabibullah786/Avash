import { useEffect, useState, type FormEvent } from 'react';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useSession } from '../auth/SessionProvider';
import { useSubscribeAlert } from './useSubscribeAlert';
import { useUnsubscribeAlert } from './useUnsubscribeAlert';
import { useAlertSubscription } from './useAlertSubscription';
import { SubmitButton } from '../../components/SubmitButton';

/** Bounds mirror `alertSubscribeSchema` in packages/types/alerts.ts EXACTLY (100–20,000). */
const ALERT_RADIUS_MIN_M = 100;
const ALERT_RADIUS_MAX_M = 20_000;
/** Matches `alertSubscribeSchema`'s own `.default(2000)`. */
const ALERT_RADIUS_DEFAULT_M = 2000;

/** Fixed, generic message only — the browser's geolocation error is never rendered directly. */
const LOCATION_GENERIC_ERROR = 'Unable to determine your location. Please try again or check location permissions.';

/**
 * Proximity alert subscription form (feature 7 / `/api/alerts/subscribe`).
 *
 * A user holds at most one geofence (`alert_subscriptions_user_id_key`),
 * so this single form covers all three operations: subscribing, moving or
 * resizing the existing geofence (the route upserts on `user_id`), and
 * removing it (DELETE). Which one the submit button performs is stated in
 * its label rather than inferred, because "Subscribe" on a form that
 * silently overwrites an existing subscription is a different action from
 * the one it names.
 *
 * The current subscription comes from `useAlertSubscription`, read
 * directly from Supabase via RLS — real persisted state, unlike the
 * mutation's own `isSuccess`, which reverts on every reload.
 */
export function AlertSubscribeForm() {
  const { accessToken, user } = useSession();
  const geolocation = useGeolocation();
  const subscribe = useSubscribeAlert();
  const unsubscribe = useUnsubscribeAlert();
  const existing = useAlertSubscription(user?.id ?? null);
  const [radiusM, setRadiusM] = useState<number>(ALERT_RADIUS_DEFAULT_M);
  const [radiusTouched, setRadiusTouched] = useState(false);
  const [justSaved, setJustSaved] = useState<'saved' | 'removed' | null>(null);

  const current = existing?.data ?? null;
  const hasSubscription = current !== null;

  // Seed the input from the stored radius so the form opens on the value
  // the user actually has, not the default — editing radius alone should
  // not silently reset it. Stops once the user types, so a background
  // refetch can never overwrite what they are in the middle of entering.
  useEffect(() => {
    if (!radiusTouched && typeof current?.radiusM === 'number' && current.radiusM > 0) {
      setRadiusM(current.radiusM);
    }
  }, [current?.radiusM, radiusTouched]);

  const locationRequested = geolocation?.status !== 'idle';
  const hasLocation = typeof geolocation?.lat === 'number' && typeof geolocation?.lng === 'number';
  const locationFailed = geolocation?.status === 'denied' || geolocation?.status === 'unavailable';
  const radiusEmpty = !Number.isFinite(radiusM);
  const radiusValid = !radiusEmpty && radiusM >= ALERT_RADIUS_MIN_M && radiusM <= ALERT_RADIUS_MAX_M;
  const isPending = Boolean(subscribe?.isPending);
  const isRemoving = Boolean(unsubscribe?.isPending);

  // Updating an existing subscription still requires a fresh point: the
  // route's body carries lat/lng and there is no partial update, so
  // submitting without a location would move the geofence to nowhere.
  const canSubmit = Boolean(accessToken) && hasLocation && radiusValid && !isPending && !isRemoving;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event?.preventDefault?.();
    if (!canSubmit || geolocation?.lat === null || geolocation?.lng === null || !accessToken) {
      return;
    }
    setJustSaved(null);
    subscribe?.mutate?.(
      {
        lat: geolocation.lat as number,
        lng: geolocation.lng as number,
        radiusM,
        active: true,
        accessToken,
      },
      { onSuccess: () => setJustSaved('saved') }
    );
  };

  const handleUnsubscribe = () => {
    if (!accessToken || isRemoving || isPending) {
      return;
    }
    setJustSaved(null);
    unsubscribe?.mutate?.(accessToken, {
      onSuccess: () => {
        setJustSaved('removed');
        setRadiusTouched(false);
        setRadiusM(ALERT_RADIUS_DEFAULT_M);
      },
    });
  };

  return (
    <div>
      {existing?.isLoading ? null : hasSubscription ? (
        <div className="status-panel__item" data-testid="alert-subscribe-status">
          <p>
            You have an active alert subscription
            {typeof current?.lat === 'number' && typeof current?.lng === 'number'
              ? ` centred on ${current.lat.toFixed(4)}, ${current.lng.toFixed(4)}`
              : ''}{' '}
            with a {current?.radiusM ?? ALERT_RADIUS_DEFAULT_M} m radius — we'll notify you if dengue risk rises
            nearby.
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={handleUnsubscribe}
            disabled={isRemoving || isPending}
            data-testid="alert-unsubscribe"
          >
            {isRemoving ? 'Removing…' : 'Unsubscribe'}
          </button>
        </div>
      ) : (
        <p className="status-panel__item" data-testid="alert-subscribe-none">
          You have no active alert subscription.
        </p>
      )}

      {existing?.isError ? (
        <p className="field__error" data-testid="alert-subscription-load-error">
          {existing.error?.message ?? 'Unable to load your alert subscription right now.'}
        </p>
      ) : null}

      {justSaved === 'saved' ? (
        <div className="alert" data-testid="alert-subscribe-success">
          Saved — we'll alert you if dengue risk rises near this location.
        </div>
      ) : justSaved === 'removed' ? (
        <div className="alert" data-testid="alert-unsubscribe-success">
          Removed — you'll no longer receive proximity alerts.
        </div>
      ) : null}

      {unsubscribe?.isError ? (
        <p className="field__error" data-testid="alert-unsubscribe-error">
          {unsubscribe.error?.message ?? 'Something went wrong. Please try again.'}
        </p>
      ) : null}

      <form className="form" onSubmit={handleSubmit} data-testid="alert-subscribe-form">
        <fieldset disabled={isPending || isRemoving}>
          <legend className="field__label" data-testid="alert-subscribe-legend">
            {hasSubscription ? 'Move or resize your alert area' : 'Set up your alert area'}
          </legend>

          <div className="field">
            <span className="field__label">Location</span>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => geolocation?.request?.()}
              disabled={isPending || isRemoving || geolocation?.status === 'requesting'}
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
                {hasSubscription
                  ? 'Set your location to move your alert area here.'
                  : 'Set your location before subscribing.'}
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
              disabled={isPending || isRemoving}
              onChange={(event) => {
                const raw = event?.target?.value;
                setRadiusTouched(true);
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
          pendingLabel={hasSubscription ? 'Updating…' : 'Subscribing…'}
          data-testid="alert-subscribe-submit"
        >
          {hasSubscription ? 'Update my alert area' : 'Subscribe to alerts'}
        </SubmitButton>
      </form>
    </div>
  );
}
