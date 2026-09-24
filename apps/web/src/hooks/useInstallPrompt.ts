import { useCallback, useEffect, useState } from 'react';

/**
 * Chromium's `beforeinstallprompt` event. Not in TypeScript's DOM lib
 * (it is not a standard — Safari and Firefox never fire it), so the shape
 * is declared here rather than imported.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPromptStatus =
  /** Still deciding — no event yet, and not detectably installed. */
  | 'idle'
  /** A prompt is held and `promptInstall()` will show it. */
  | 'available'
  /** The user accepted, or the app is already running installed. */
  | 'installed'
  /** The user dismissed the prompt this session. */
  | 'dismissed';

export interface UseInstallPromptResult {
  status: InstallPromptStatus;
  /** Shows the held browser prompt. No-op unless `status === 'available'`. */
  promptInstall: () => Promise<void>;
}

/**
 * True when the page is already running as an installed app rather than
 * in a browser tab. `display-mode: standalone` covers Android/desktop;
 * `navigator.standalone` is the iOS-only equivalent Safari never replaced.
 */
function isRunningInstalled(): boolean {
  const standaloneIos = (navigator as { standalone?: boolean })?.standalone === true;
  const standaloneDisplay = window?.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return standaloneIos || standaloneDisplay;
}

/**
 * Captures Chromium's `beforeinstallprompt` so the app can offer
 * installation from its own UI at a moment that makes sense, instead of
 * leaving it buried in the browser menu.
 *
 * WHY AN IN-APP CONTROL MATTERS HERE, beyond convenience: an installed
 * PWA is the only context where Web Push works on iOS/iPadOS at all, and
 * on Android an installed app is what keeps notification delivery working
 * once the browser is closed. So the install affordance is part of the
 * alerting feature, not decoration.
 *
 * The event must be captured the moment it fires and it fires ONCE, early
 * — a component that mounts later has already missed it. `preventDefault`
 * stops Chromium's own mini-infobar so the browser does not race this
 * app's UI with a competing prompt.
 *
 * Every browser API touched here is optional-chained (R4): Safari and
 * Firefox never fire `beforeinstallprompt` at all, and this hook must
 * degrade to `status: 'idle'` there rather than throw.
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<InstallPromptStatus>('idle');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (isRunningInstalled()) {
      setStatus('installed');
      return undefined;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event?.preventDefault?.();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setStatus('available');
    };

    // Fires when the install completes through ANY route — this app's
    // button, the browser menu, or an OS-level install. Without it the UI
    // keeps offering to install an app the user already has.
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setStatus('installed');
    };

    window.addEventListener?.('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener?.('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener?.('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener?.('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return;
    }
    try {
      await deferredPrompt.prompt?.();
      const choice = await deferredPrompt.userChoice;
      setStatus(choice?.outcome === 'accepted' ? 'installed' : 'dismissed');
    } catch {
      // A prompt can only be shown once; a second call rejects. Treat any
      // failure as dismissal rather than surfacing a browser-internal
      // error to someone who just wanted a home screen icon.
      setStatus('dismissed');
    } finally {
      // Single-use either way — the browser discards the event after
      // prompt(), so holding it would let the UI offer a dead button.
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  return { status, promptInstall };
}
