import { useInstallPrompt } from '../../hooks/useInstallPrompt';

/**
 * Offers to install Avash to the home screen, next to the push toggle
 * because the two are the same feature from a user's point of view: an
 * installed app is what keeps alerts arriving once the browser is closed,
 * and on iOS/iPadOS it is the only context where Web Push works at all.
 *
 * Renders NOTHING unless the browser has actually offered an install
 * (`beforeinstallprompt`), which is the only honest way to show this
 * control — Safari and Firefox never fire it, and a button that cannot
 * do anything is worse than no button. See `useInstallPrompt` for how the
 * event is captured.
 */
export function InstallAppPrompt() {
  const { status, promptInstall } = useInstallPrompt();

  if (status === 'installed') {
    return (
      <p className="status-panel__item" data-testid="install-prompt-installed">
        Avash is installed on this device — alerts arrive even with the browser closed.
      </p>
    );
  }

  if (status !== 'available') {
    // 'idle' covers both "the browser has not offered yet" and "this
    // browser never will". 'dismissed' is deliberately silent for the
    // rest of the session rather than re-nagging.
    return null;
  }

  return (
    <div className="field" data-testid="install-prompt">
      <p className="page__description">
        Install Avash on this device to open it like an app and keep receiving alerts when your browser is closed.
      </p>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => void promptInstall()}
        data-testid="install-prompt-button"
      >
        Install Avash
      </button>
    </div>
  );
}
