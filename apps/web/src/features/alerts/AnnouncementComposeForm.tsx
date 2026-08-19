import { useEffect, useState, type FormEvent } from 'react';
import {
  appRoleSchema,
  ANNOUNCEMENT_TITLE_MAX_CHARS,
  ANNOUNCEMENT_BODY_MAX_CHARS,
  ANNOUNCEMENT_RADIUS_DEFAULT_M,
  type AppRole,
} from '@avash/types';
import { can } from '@avash/security';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useSession } from '../auth/SessionProvider';
import { useCreateAnnouncement } from './useCreateAnnouncement';
import { SubmitButton } from '../../components/SubmitButton';

/** Bounds mirror `announcementCreateSchema` in packages/types/alerts.ts EXACTLY (500–50,000) — NOT the alert-subscribe bounds (100–20,000). */
const ANNOUNCEMENT_RADIUS_MIN_M = 500;
const ANNOUNCEMENT_RADIUS_MAX_M = 50_000;

const TARGET_ROLE_OPTIONS: readonly AppRole[] = appRoleSchema.options;

/**
 * Moderator/admin-only broadcast form (`POST /api/announcements`).
 * Presentation gating only — `can(role, 'reports:moderate')` hides the
 * form from a citizen client-side, but the server enforces its own
 * `auth (JWT + capability)` check independently (docs/PROJECT_PLAN.md §6),
 * which is what actually stops a non-moderator from posting.
 *
 * Every field below shows its own specific reason when invalid — the
 * submit button being merely disabled, with no visible explanation, is
 * not enough for a moderator to know what to fix.
 */
export function AnnouncementComposeForm() {
  const { accessToken, role } = useSession();
  const geolocation = useGeolocation();
  const create = useCreateAnnouncement();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [radiusM, setRadiusM] = useState<number>(ANNOUNCEMENT_RADIUS_DEFAULT_M);
  const [expiresAt, setExpiresAt] = useState('');
  const [targetRoles, setTargetRoles] = useState<AppRole[]>([]);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  useEffect(() => {
    if (geolocation?.status === 'granted') {
      setLat(geolocation.lat ?? null);
      setLng(geolocation.lng ?? null);
    }
  }, [geolocation?.status, geolocation?.lat, geolocation?.lng]);

  const isModerator = can(role, 'reports:moderate');

  const hasLocation = typeof lat === 'number' && typeof lng === 'number';
  const locationFailed = geolocation?.status === 'denied' || geolocation?.status === 'unavailable';

  const titleTrimmed = title.trim();
  const titleEmpty = titleTrimmed.length === 0;
  const titleTooLong = title.length > ANNOUNCEMENT_TITLE_MAX_CHARS;
  const titleValid = !titleEmpty && !titleTooLong;

  const bodyTrimmed = body.trim();
  const bodyEmpty = bodyTrimmed.length === 0;
  const bodyTooLong = body.length > ANNOUNCEMENT_BODY_MAX_CHARS;
  const bodyValid = !bodyEmpty && !bodyTooLong;

  const radiusEmpty = !Number.isFinite(radiusM);
  const radiusOutOfRange =
    !radiusEmpty && (radiusM < ANNOUNCEMENT_RADIUS_MIN_M || radiusM > ANNOUNCEMENT_RADIUS_MAX_M);
  const radiusValid = !radiusEmpty && !radiusOutOfRange;

  const expiresEmpty = expiresAt.trim().length === 0;
  const expiresDate = expiresEmpty ? null : new Date(expiresAt);
  const expiresInvalidDate = !expiresEmpty && Number.isNaN(expiresDate?.getTime());
  const expiresInPast = !expiresEmpty && !expiresInvalidDate && (expiresDate?.getTime() ?? 0) <= Date.now();
  const expiresValid = !expiresEmpty && !expiresInvalidDate && !expiresInPast;

  const isPending = Boolean(create?.isPending);
  const canSubmit =
    Boolean(accessToken) && hasLocation && titleValid && bodyValid && radiusValid && expiresValid && !isPending;

  if (!isModerator) {
    return null;
  }

  const toggleTargetRole = (option: AppRole) => {
    setTargetRoles((current) =>
      current.includes(option) ? current.filter((entry) => entry !== option) : [...current, option]
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event?.preventDefault?.();
    // canSubmit already gates the button's disabled state, so this is
    // reached only when every field is already valid — defense in depth,
    // not the primary error-surfacing path (see the always-visible field
    // errors below, which is what a real click on a disabled button can
    // never reach in a browser).
    if (!canSubmit || lat === null || lng === null || !accessToken) {
      return;
    }

    create?.mutate?.(
      {
        title: title.trim(),
        body: body.trim(),
        lat,
        lng,
        radiusM,
        targetRoles,
        expiresAt: new Date(expiresAt).toISOString(),
        accessToken,
      },
      {
        onSuccess: () => {
          setTitle('');
          setBody('');
          setExpiresAt('');
          setTargetRoles([]);
        },
      }
    );
  };

  return (
    <form className="form" onSubmit={handleSubmit} data-testid="announcement-compose-form">
      <fieldset disabled={isPending}>
        <div className="field">
          <label htmlFor="announcement-title" className="field__label">
            Title
          </label>
          <input
            id="announcement-title"
            data-testid="announcement-title"
            maxLength={ANNOUNCEMENT_TITLE_MAX_CHARS}
            value={title}
            onChange={(event) => setTitle(event?.target?.value ?? '')}
          />
          {!titleValid ? (
            <p className="field__error" data-testid="announcement-title-error">
              {titleEmpty ? 'Title is required.' : `Title must be ${ANNOUNCEMENT_TITLE_MAX_CHARS} characters or fewer.`}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="announcement-body" className="field__label">
            Message
          </label>
          <textarea
            id="announcement-body"
            data-testid="announcement-body"
            rows={4}
            maxLength={ANNOUNCEMENT_BODY_MAX_CHARS}
            value={body}
            onChange={(event) => setBody(event?.target?.value ?? '')}
          />
          {!bodyValid ? (
            <p className="field__error" data-testid="announcement-body-error">
              {bodyEmpty ? 'Message is required.' : `Message must be ${ANNOUNCEMENT_BODY_MAX_CHARS} characters or fewer.`}
            </p>
          ) : null}
        </div>

        <div className="field">
          <span className="field__label">Location</span>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => geolocation?.request?.()}
            disabled={geolocation?.status === 'requesting'}
            data-testid="announcement-locate"
          >
            {geolocation?.status === 'requesting' ? 'Locating…' : 'Use my location'}
          </button>

          <label htmlFor="announcement-lat" className="field__label">
            Latitude
          </label>
          <input
            id="announcement-lat"
            data-testid="announcement-lat"
            type="number"
            step="any"
            min={-90}
            max={90}
            value={lat ?? ''}
            onChange={(event) => {
              const value = event?.target?.value;
              setLat(value === '' ? null : Number(value));
            }}
          />

          <label htmlFor="announcement-lng" className="field__label">
            Longitude
          </label>
          <input
            id="announcement-lng"
            data-testid="announcement-lng"
            type="number"
            step="any"
            min={-180}
            max={180}
            value={lng ?? ''}
            onChange={(event) => {
              const value = event?.target?.value;
              setLng(value === '' ? null : Number(value));
            }}
          />

          {locationFailed ? (
            <p className="field__error" data-testid="announcement-location-error">
              Unable to determine your location. Please try again or enter latitude/longitude manually.
            </p>
          ) : !hasLocation ? (
            <p className="field__error" data-testid="announcement-location-hint">
              Location is required.
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="announcement-radius" className="field__label">
            Radius (meters)
          </label>
          <input
            id="announcement-radius"
            data-testid="announcement-radius"
            type="number"
            min={ANNOUNCEMENT_RADIUS_MIN_M}
            max={ANNOUNCEMENT_RADIUS_MAX_M}
            value={Number.isNaN(radiusM) ? '' : radiusM}
            onChange={(event) => {
              const raw = event?.target?.value;
              setRadiusM(raw === '' || raw === undefined ? Number.NaN : Number(raw));
            }}
          />
          {radiusEmpty ? (
            <p className="field__error" data-testid="announcement-radius-error">
              Radius is required.
            </p>
          ) : radiusOutOfRange ? (
            <p className="field__error" data-testid="announcement-radius-error">
              Radius must be between {ANNOUNCEMENT_RADIUS_MIN_M} and {ANNOUNCEMENT_RADIUS_MAX_M} meters.
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="announcement-expires" className="field__label">
            Expires at
          </label>
          <input
            id="announcement-expires"
            data-testid="announcement-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event?.target?.value ?? '')}
          />
          {!expiresValid ? (
            <p className="field__error" data-testid="announcement-expires-error">
              {expiresEmpty
                ? 'Expiry date is required.'
                : expiresInvalidDate
                  ? 'Expiry date is not a valid date.'
                  : 'Expiry date must be in the future.'}
            </p>
          ) : null}
        </div>

        <fieldset className="field">
          <legend className="field__label">Target roles (none selected = every role)</legend>
          {TARGET_ROLE_OPTIONS.map((option) => (
            <label key={option} className="field__label">
              <input
                type="checkbox"
                checked={targetRoles.includes(option)}
                onChange={() => toggleTargetRole(option)}
                data-testid={`announcement-target-role-${option}`}
              />
              {option}
            </label>
          ))}
        </fieldset>
      </fieldset>

      {create?.isError ? (
        <p className="field__error" data-testid="announcement-compose-error">
          {create.error?.message ?? 'Something went wrong. Please try again.'}
        </p>
      ) : null}

      <SubmitButton
        pending={isPending}
        disabled={!canSubmit}
        pendingLabel="Publishing…"
        data-testid="announcement-compose-submit"
      >
        Publish announcement
      </SubmitButton>
    </form>
  );
}
