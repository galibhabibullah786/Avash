import { useState } from 'react';
import { useSession } from '../auth/SessionProvider';
import { usePushSubscription } from '../../hooks/usePushSubscription';
import { ensureServiceWorkerRegistration } from '../../lib/serviceWorker';

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
  const [testSent, setTestSent] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  const handleSendTestNotification = async () => {
    try {
      const reg = await ensureServiceWorkerRegistration();
      if (reg?.showNotification) {
        await reg.showNotification('Notification Test', {
          body: 'Notification is working.',
          tag: 'test-dengue-risk',
          icon: '/icons/icon-192.png',
          data: { url: '/risk-map' },
        });
        setTestSent(true);
        setTimeout(() => setTestSent(false), 3000);
      }
    } catch (err) {
      console.error('Failed to trigger test notification:', err);
    }
  };

  const handleCopyToken = async () => {
    try {
      const reg = await ensureServiceWorkerRegistration();
      const sub = await reg?.pushManager?.getSubscription?.();
      if (sub) {
        const subJson = sub.toJSON();
        const cliArgs = `--direct-endpoint "${sub.endpoint}" --p256dh "${subJson.keys?.p256dh || ''}" --auth "${subJson.keys?.auth || ''}"`;
        await navigator.clipboard.writeText(cliArgs);
        setTokenCopied(true);
        setTimeout(() => setTokenCopied(false), 3000);
      }
    } catch (err) {
      console.error('Failed to copy subscription token:', err);
    }
  };

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
        <div>
          <p className="status-panel__item" data-testid="push-toggle-subscribed">
            Push notifications are active on this device.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="button button--secondary"
              onClick={handleSendTestNotification}
              data-testid="push-toggle-test"
            >
              {testSent ? 'Notification Triggered!' : 'Send Test Notification to This Device'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={handleCopyToken}
              data-testid="push-toggle-copy-token"
            >
              {tokenCopied ? 'Token Copied to Clipboard!' : 'Copy Device Token for CLI Test'}
            </button>
          </div>
        </div>
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
