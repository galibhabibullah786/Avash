import { useSession } from '../auth/SessionProvider';
import { usePushSubscription } from '../../hooks/usePushSubscription';

/**
 * Registers this browser to receive Web Push alerts, and reports whether
 * it already is.
 *
 * Without this control nothing ever called `usePushSubscription`, so
 * `push_subscriptions` stayed empty and `ml/serving/push_delivery.py` had
 * no endpoint to send to no matter how many `alert_subscriptions` matched
 * — a proximity subscription alone only says WHERE to alert you, never
 * HOW to reach you. Both halves are required.
 *
 * Permission is requested from the click handler, never an effect:
 * `Notification.requestPermission()` outside a user gesture is refused
 * outright by most browsers.
 */
export function PushNotificationToggle() {
  const { accessToken } = useSession();
  const push = usePushSubscription(accessToken ?? null);
  const status = push?.status ?? 'checking';

  // Resolving the real state needs a round trip to the service worker
  // registration, so render nothing rather than flashing "Enable" at a
  // browser that turns out to be subscribed already.
  if (status === 'checking') {
    return <p className="status-panel__item" data-testid="push-toggle-checking">Checking notification status…</p>;
  }

  if (status === 'unsupported') {
    return (
      <p className="status-panel__item" data-testid="push-toggle-unsupported">
        This browser doesn't support push notifications, so alerts will only appear here on the dashboard. On iPhone
        or iPad, add Avash to your Home Screen first — Safari only offers notifications to an installed app.
      </p>
    );
  }

  if (status === 'unconfigured') {
    return (
      <p className="field__error" data-testid="push-toggle-unconfigured">
        Push notifications aren't configured for this deployment, so alerts will only appear here on the dashboard.
      </p>
    );
  }

  return (
    <div className="field" data-testid="push-toggle">
      {status === 'subscribed' ? (
        <p className="status-panel__item" data-testid="push-toggle-subscribed">
          Push notifications are on for this browser — alerts reach you even when Avash is closed.
        </p>
      ) : (
        <>
          <p className="page__description">
            Turn on push notifications to be alerted even when this site is closed.
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void push?.subscribe?.()}
            disabled={status === 'requesting' || !accessToken}
            data-testid="push-toggle-enable"
          >
            {status === 'requesting' ? 'Enabling…' : 'Enable push notifications'}
          </button>
        </>
      )}

      {status === 'denied' ? (
        <p className="field__error" data-testid="push-toggle-denied">
          Notifications are blocked for this site. Allow them in your browser's site settings, then try again.
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="field__error" data-testid="push-toggle-error">
          Unable to enable push notifications right now. Please try again.
        </p>
      ) : null}
    </div>
  );
}
