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
  const { status, promptInstall, isIos } = useInstallPrompt();

  if (status === 'installed') {
    return (
      <p className="status-panel__item" data-testid="install-prompt-installed">
        এই ডিভাইসে আভাস ইনস্টল করা আছে — ব্রাউজার বন্ধ থাকলেও সতর্কতা বার্তা পৌঁছাবে।
      </p>
    );
  }

  if (isIos && status !== 'dismissed') {
    return (
      <div className="field" data-testid="install-prompt-ios">
        <p className="page__description">
          আইফোনে ডেঙ্গু সতর্কতা সক্রিয় করতে: Safari-এর <b>Share ⎋</b> বোতাম চেপে <b>&apos;Add to Home Screen ⊞&apos;</b> নির্বাচন করুন।
        </p>
      </div>
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
        ব্রাউজার বন্ধ থাকলেও তাৎক্ষণিক ডেঙ্গু সতর্কতা পেতে আপনার ডিভাইসে আভাস অ্যাপটি ইনস্টল করুন।
      </p>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => void promptInstall()}
        data-testid="install-prompt-button"
      >
        আভাস ইনস্টল করুন
      </button>
    </div>
  );
}
